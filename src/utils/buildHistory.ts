import type { proto } from "baileys";

interface HistoryMessage {
    content: {
        type: "text" | "image" | "video" | "document" | "audio" | "sticker" | "unknown";
        text?: string;
        caption?: string;
        url?: string;
        filename?: string;
    };
}

export function buildHistory(messages: proto.IWebMessageInfo[] = []): HistoryMessage[] {
    return (messages || []).map((message) => {
        const msg = message.message;

        if (!msg.conversation) return;
        // Texto simple
        if (msg.conversation) {
            return {
                content: {
                    type: "text",
                    text: msg.conversation,
                },
                key: message.key,
            };
        }

        // Texto extendido
        if (msg.extendedTextMessage) {
            return {
                content: {
                    type: "text",
                    text: msg.extendedTextMessage.text || "",
                },
                key: message.key,
            };
        }

        // Imagen
        if (msg.imageMessage) {
            return {
                content: {
                    type: "image",
                    caption: msg.imageMessage.caption || undefined,
                    url: msg.imageMessage.url || undefined,
                },
                key: message.key,
            };
        }

        // Documento
        if (msg.documentMessage) {
            return {
                content: {
                    type: "document",
                    filename: msg.documentMessage.fileName || undefined,
                    caption: msg.documentMessage.caption || undefined,
                    url: msg.documentMessage.url || undefined,
                },
                key: message.key,
            };
        }

        // Video
        if (msg.videoMessage) {
            return {
                content: {
                    type: "video",
                    caption: msg.videoMessage.caption || undefined,
                    url: msg.videoMessage.url || undefined,
                },
                key: message.key,
            };
        }

        // Audio
        if (msg.audioMessage) {
            return {
                content: {
                    type: "audio",
                    url: msg.audioMessage.url || undefined,
                },
                key: message.key,
            };
        }

        // Sticker
        if (msg.stickerMessage) {
            return {
                content: {
                    type: "sticker",
                    url: msg.stickerMessage.url || undefined,
                },
                key: message.key,
            };
        }

        // Tipo desconocido
        return {
            content: {
                type: "unknown",
            },
            key: message.key,
        };
    });
}