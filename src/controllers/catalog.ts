import type { RequestHandler } from "express";
import { logger } from "@/utils";
import WhatsappService from "@/whatsapp/service";
import type { Product } from "baileys";

export const list: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { cursor = undefined, limit = 10, jid } = req.query;

        const session = WhatsappService.getSession(sessionId);
        if (!jid) {
            return res.status(400).json({ error: "JID is required" });
        }

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        const seconds = 15;

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Request timeout")), seconds * 1000);
        });

        const catalogPromise = session.getCatalog({
            jid: jid as string,
            limit: limit as number,
            cursor: cursor as string,
        }) as Promise<{
            products: Product[];
            nextPageCursor: string | undefined;
        }>;

        // console.log("-----catalogPromise", JSON.stringify(catalogPromise, null, 2));

        const catalog = await Promise.race([catalogPromise, timeoutPromise]) as {
            products: Product[];
            nextPageCursor: string | undefined;
        };

        console.log("-----catalog", catalog.products[0]);

        res.status(200).json({
            data: catalog,
        });
    } catch (e) {
        const message = e instanceof Error && e.message === "Request timeout"
            ? "Request timed out after 15 seconds"
            : "An error occured during chat list";
        logger.error(e, message);
        res.status(500).json({ error: message });
    }
};