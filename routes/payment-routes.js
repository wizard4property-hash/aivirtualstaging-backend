import express from "express";

import PaymentController from "../controllers/payment-controllers.js";

const router = express.Router();

router.post("/dodo-confirm-payment", PaymentController.DodoConfirmPayment);

export default router;
