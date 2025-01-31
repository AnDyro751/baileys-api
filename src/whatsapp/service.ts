import makeWASocket, {
	DisconnectReason,
	isJidBroadcast,
	makeCacheableSignalKeyStore,
} from "baileys";
import type { ConnectionState, SocketConfig, WASocket, proto } from "baileys";
import { Store, useSession } from "./store";
import { prisma } from "@/config/database";
import { logger, delay, emitEvent } from "@/utils";
import { WAStatus } from "@/types";
import type { Boom } from "@hapi/boom";
import type { Response } from "express";
import { toDataURL } from "qrcode";
import type { WebSocket as WebSocketType } from "ws";
import env from "@/config/env";

export type Session = WASocket & {
	destroy: () => Promise<void>;
	store: Store;
	waStatus?: WAStatus;
};

type createSessionOptions = {
	sessionId: string;
	res?: Response;
	SSE?: boolean;
	readIncomingMessages?: boolean;
	socketConfig?: SocketConfig;
};

class WhatsappService {
	private static sessions = new Map<string, Session>();
	private static retries = new Map<string, number>();
	private static SSEQRGenerations = new Map<string, number>();

	constructor() {
		this.init();
	}

	private async init() {
		logger.info("-----init 1");

		const currentSessions = WhatsappService.sessions.keys();

		console.log("-----currentSessions", JSON.stringify(currentSessions));

		const storedSessions = await prisma.session.findMany({
			select: { sessionId: true, data: true },
			where: { id: { startsWith: env.SESSION_CONFIG_ID } },
			// where: { id: { notIn: Array.from(currentSessions) } },
		});

		console.log("-----storedSessions", storedSessions);
		for (const { sessionId, data } of storedSessions) {
			const { readIncomingMessages, ...socketConfig } = JSON.parse(data);
			console.log("-----create session", sessionId);
			WhatsappService.createSession({ sessionId, readIncomingMessages, socketConfig });
		}
		logger.info("-----init 2", storedSessions);
	}

	private static updateWaConnection(sessionId: string, waStatus: WAStatus) {
		if (WhatsappService.sessions.has(sessionId)) {
			const _session = WhatsappService.sessions.get(sessionId)!;
			WhatsappService.sessions.set(sessionId, { ..._session, waStatus });
			emitEvent("connection.update", sessionId, { status: waStatus });
		}
	}

	private static shouldReconnect(sessionId: string) {
		let attempts = WhatsappService.retries.get(sessionId) ?? 0;
		console.log("-----shouldReconnect ASJNAJ", attempts, `${attempts}`, "----", sessionId);
		logger.info("-----shouldReconnect ASJNAJ", attempts, `${attempts}`, "----", sessionId);
		if (attempts < env.MAX_RECONNECT_RETRIES) {
			attempts += 1;
			WhatsappService.retries.set(sessionId, attempts);
			return true;
		}
		return false;
	}

	static async createSession(options: createSessionOptions) {
		const { sessionId, res, SSE = false, readIncomingMessages = false, socketConfig } = options;
		const configID = `${env.SESSION_CONFIG_ID}-${sessionId}`;

		let connectionState: Partial<ConnectionState> = { connection: "close" };

		const destroy = async (logout = true) => {
			logger.info("-----destroy session INIINI");
			try {
				prisma.session.deleteMany({
					where: {
						sessionId: sessionId
					}
				});
				logout && socket.logout();
				logger.info({ session: sessionId }, "Se ha eliminado la sesión");
			} catch (e) {
				logger.error(e, "An error occurred during session destroy");
			} finally {
				console.log("-------delete session en el finally", sessionId);
				WhatsappService.sessions.delete(sessionId);
				WhatsappService.updateWaConnection(sessionId, WAStatus.Disconected);
			}
		};

		const handleConnectionClose = () => {
			const code = (connectionState.lastDisconnect?.error as Boom)?.output?.statusCode;
			const restartRequired = code === DisconnectReason.restartRequired;
			const doNotReconnect = !WhatsappService.shouldReconnect(sessionId);

			WhatsappService.updateWaConnection(sessionId, WAStatus.Disconected);

			if (code === DisconnectReason.loggedOut || doNotReconnect) {
				if (res) {
					!SSE &&
						!res.headersSent &&
						res.status(500).json({ error: "Unable to create session" });
					res.end();
				}
				logger.error("-----Unable to create session--- destroy");
				destroy(true);
				return;
			}

			if (!restartRequired) {
				logger.info(
					{ attempts: WhatsappService.retries.get(sessionId) ?? 1, sessionId },
					"Reconnecting...",
				);
			}
			setTimeout(
				() => WhatsappService.createSession(options),
				restartRequired ? 0 : env.RECONNECT_INTERVAL,
			);
		};

		const handleNormalConnectionUpdate = async () => {
			if (connectionState.qr?.length) {
				if (res && !res.headersSent) {
					try {
						const qr = await toDataURL(connectionState.qr);
						WhatsappService.updateWaConnection(sessionId, WAStatus.WaitQrcodeAuth);
						emitEvent("qrcode.updated", sessionId, { qr });
						res.status(200).json({ qr });
						return;
					} catch (e) {
						logger.error(e, "An error occurred during QR generation");
						emitEvent(
							"qrcode.updated",
							sessionId,
							undefined,
							"error",
							`Unable to generate QR code: ${e.message}`,
						);
						res.status(500).json({ error: "Unable to generate QR" });
					}
				}
				logger.error("----2-Unable to create session--- destroy");
				// destroy();
			}
		};

		const handleSSEConnectionUpdate = async () => {
			let qr: string | undefined = undefined;
			if (connectionState.qr?.length) {
				try {
					WhatsappService.updateWaConnection(sessionId, WAStatus.WaitQrcodeAuth);
					qr = await toDataURL(connectionState.qr);
				} catch (e) {
					logger.error(e, "An error occurred during QR generation");
					emitEvent(
						"qrcode.updated",
						sessionId,
						undefined,
						"error",
						`Unable to generate QR code: ${e.message}`,
					);
				}
			}

			const currentGenerations = WhatsappService.SSEQRGenerations.get(sessionId) ?? 0;
			if (
				!res ||
				res.writableEnded ||
				(qr && currentGenerations >= env.SSE_MAX_QR_GENERATION)
			) {
				res && !res.writableEnded && res.end();
				logger.error("-----3-Unable to create session--- destroy");
				// destroy();
				return;
			}

			const data = { ...connectionState, qr };
			if (qr) {
				WhatsappService.SSEQRGenerations.set(sessionId, currentGenerations + 1);
				emitEvent("qrcode.updated", sessionId, { qr });
			}
			res.write(`data: ${JSON.stringify(data)}\n\n`);
		};

		const handleConnectionUpdate = SSE
			? handleSSEConnectionUpdate
			: handleNormalConnectionUpdate;
		const { state, saveCreds } = await useSession(sessionId);
		const socket = makeWASocket({
			printQRInTerminal: false,
			browser: [env.BOT_NAME || "Whatsapp Bot", "Chrome", "3.0"],
			generateHighQualityLinkPreview: true,
			...socketConfig,
			auth: {
				creds: state.creds,
				keys: makeCacheableSignalKeyStore(state.keys, logger),
			},
			version: [2, 3000, 1015901307],
			logger,
			shouldIgnoreJid: (jid) => isJidBroadcast(jid),
			getMessage: async (key) => {
				const data = await prisma.message.findFirst({
					where: { remoteJid: key.remoteJid!, id: key.id!, sessionId },
				});
				return (data?.message || undefined) as proto.IMessage | undefined;
			},
		});

		const store = new Store(sessionId, socket.ev);

		WhatsappService.sessions.set(sessionId, {
			...socket,
			destroy,
			store,
			waStatus: WAStatus.Unknown,
		});

		socket.ev.on("creds.update", saveCreds);
		socket.ev.on("connection.update", (update) => {
			connectionState = update;
			const { connection } = update;

			if (connection === "open") {
				WhatsappService.updateWaConnection(
					sessionId,
					update.isNewLogin ? WAStatus.Authenticated : WAStatus.Connected,
				);
				WhatsappService.retries.delete(sessionId);
				WhatsappService.SSEQRGenerations.delete(sessionId);
			}
			if (connection === "close") handleConnectionClose();
			if (connection === "connecting")
				WhatsappService.updateWaConnection(sessionId, WAStatus.PullingWAData);
			handleConnectionUpdate();
		});

		if (readIncomingMessages) {
			socket.ev.on("messages.upsert", async (m) => {
				const message = m.messages[0];
				if (message.key.fromMe || m.type !== "notify") return;

				await delay(1000);
				await socket.readMessages([message.key]);
			});
		}

		try {
			await prisma.session.upsert({
				create: {
					id: configID,
					sessionId,
					data: JSON.stringify({ readIncomingMessages, ...socketConfig }),
				},
				update: {
					data: JSON.stringify({ readIncomingMessages, ...socketConfig }),
				},
				where: { sessionId_id: { id: configID, sessionId } },
			});
		} catch (error) {
			logger.error(error, "Error creating session in database");
			throw error;
		}
	}

	static getSessionStatus(session: Session) {
		const state = ["CONNECTING", "CONNECTED", "DISCONNECTING", "DISCONNECTED"];
		let status = state[(session.ws as unknown as WebSocketType).readyState];
		status = session.user ? "AUTHENTICATED" : status;
		return session.waStatus !== WAStatus.Unknown ? session.waStatus : status.toLowerCase();
	}

	static listSessions() {
		return Array.from(WhatsappService.sessions.entries()).map(([id, session]) => ({
			id,
			status: WhatsappService.getSessionStatus(session),
		}));
	}

	static getSession(sessionId: string) {
		return WhatsappService.sessions.get(sessionId);
	}

	static async deleteSession(sessionId: string) {
		WhatsappService.sessions.get(sessionId)?.destroy();
		logger.error("-----delete session 1");
		WhatsappService.sessions.delete(sessionId);
	}

	static sessionExists(sessionId: string) {
		return WhatsappService.sessions.has(sessionId);
	}

	static async validJid(session: Session, jid: string, type: "group" | "number" = "number") {
		try {
			if (type === "number") {
				const [result] = await session.onWhatsApp(jid);
				if (result?.exists) {
					return result.jid;
				} else {
					return null;
				}
			}

			const groupMeta = await session.groupMetadata(jid);
			if (groupMeta.id) {
				return groupMeta.id;
			} else {
				return null;
			}
		} catch (e) {
			return null;
		}
	}

	static async jidExists(session: Session, jid: string, type: "group" | "number" = "number") {
		const validJid = await this.validJid(session, jid, type);
		return !!validJid;
	}
}

export default WhatsappService;
