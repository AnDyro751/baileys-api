import { logger } from "@/utils";
import WhatsappService from "@/whatsapp/service";
import type { Request, Response, NextFunction } from "express";

export default function sessionValidator(req: Request, res: Response, next: NextFunction) {

	if (!req.params.sessionId) {
		logger.error("-----Session ID is required");
		return res.status(400).json({ error: "Session ID is required" });
	}

	if (!WhatsappService.sessionExists(req.params.sessionId))
		return res.status(404).json({ error: "Session not found" });
	next();
}
