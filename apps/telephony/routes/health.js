const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "telephony",
    project: process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean",
    has_telnyx_api_key: Boolean(process.env.TELNYX_API_KEY),
    has_telnyx_public_key: Boolean(process.env.TELNYX_PUBLIC_KEY),
    bridge_url: process.env.BRIDGE_BASE_URL || null,
  });
});

module.exports = router;
