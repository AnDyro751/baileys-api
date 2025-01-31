import { Router } from "express";
import { query } from "express-validator";
import { catalog } from "@/controllers";
import requestValidator from "@/middlewares/request-validator";

const router = Router({ mergeParams: true });
router.get(
    "/",
    query("cursor").isString().optional(),
    query("limit").isNumeric().optional(),
    requestValidator,
    catalog.list,
);

export default router;
