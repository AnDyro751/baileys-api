import { prisma } from "@/config/database";
import { logger } from "@/utils";
import WhatsappService from "@/whatsapp/service";
import type { RequestHandler } from "express";

export const list: RequestHandler = (req, res) => {
	res.status(200).json(WhatsappService.listSessions());
};

export const find: RequestHandler = (req, res) =>
	res.status(200).json({ message: "Session found" });

export const status: RequestHandler = (req, res) => {
	const session = WhatsappService.getSession(req.params.sessionId)!;
	res.status(200).json({ status: WhatsappService.getSessionStatus(session) });
};

export const add: RequestHandler = async (req, res) => {
	const { sessionId, readIncomingMessages, ...socketConfig } = req.body;

	if (WhatsappService.sessionExists(sessionId)) {
		logger.info("-----Session already exists");
		return res.status(400).json({ error: "Ya existe una sesión. Vuelva a iniciar sesión." });
	}

	try {
		await WhatsappService.createSession({
			sessionId,
			res,
			readIncomingMessages,
			socketConfig
		});
	} catch (error) {
		logger.error("-----Failed to create session", error);
		return res.status(500).json({
			error: "Failed to create session",
			details: error.message
		});
	}
};

export const addSSE: RequestHandler = async (req, res) => {
	const { sessionId } = req.params;
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	if (WhatsappService.sessionExists(sessionId)) {
		res.write(`data: ${JSON.stringify({ error: "Ya existe una sesión. Vuelva a iniciar sesión." })}\n\n`);
		res.end();
		return;
	}
	WhatsappService.createSession({ sessionId, res, SSE: true });
};

export const del: RequestHandler = async (req, res) => {
	try {

		if (!req.params.sessionId) {
			logger.error("-----Session ID is required");
			return res.status(400).json({ message: "Session ID is required", success: false });
		}

		await prisma.session.deleteMany({
			where: {
				sessionId: req.params.sessionId
			}
		});

		await WhatsappService.deleteSession(req.params.sessionId);
		res.status(200).json({ message: "Session deleted", success: true });
	} catch (error) {
		res.status(500).json({ message: "Failed to delete session", success: false });
	}
};
