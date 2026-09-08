const http2 = require("node:http2");
const jwt = require("jsonwebtoken");
const { GoogleAuth } = require("google-auth-library");
const Device = require("./push-device-schema");
const Notification = require("./notification-schema");

function configured(platform, env = process.env) {
  return platform === "android" ? Boolean(env.FCM_PROJECT_ID) : Boolean(env.APNS_TEAM_ID && env.APNS_KEY_ID && env.APNS_PRIVATE_KEY && env.APNS_TOPIC);
}

function messageFor(notification) {
  // No enviar respuestas, medidas ni comentarios privados a la pantalla bloqueada.
  return {
    title: notification.type === "checkin_reviewed" ? "Check-in revisado" : "Nuevo check-in",
    body: notification.type === "checkin_reviewed" ? "Tu profesional ha revisado tu respuesta. Ábrela en TrainFit." : "Tienes un check-in disponible en TrainFit.",
    route: "/my-checkins", requestId: String(notification.payload?.requestId || ""),
  };
}

async function sendToDevice(device, notification) {
  if (!configured(device.platform)) throw new Error("PUSH_NOT_CONFIGURED");
  const message = messageFor(notification);
  if (device.platform === "android") {
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/firebase.messaging"] });
    const client = await auth.getClient();
    await client.request({ url: `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(process.env.FCM_PROJECT_ID)}/messages:send`, method: "POST", timeout: 10000,
      data: { message: { token: device.token, notification: { title: message.title, body: message.body },
        data: { route: message.route, requestId: message.requestId },
        android: { notification: { tag: String(notification._id), channel_id: "checkins" }, ttl: "86400s" },
      } },
    });
    return;
  }
  const token = jwt.sign({ iss: process.env.APNS_TEAM_ID }, process.env.APNS_PRIVATE_KEY.replace(/\\n/g, "\n"), {
    algorithm: "ES256", header: { kid: process.env.APNS_KEY_ID },
  });
  await new Promise((resolve, reject) => {
    const client = http2.connect(process.env.APNS_PRODUCTION === "true" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com");
    let finished = false;
    const finish = error => { if (finished) return; finished = true; client.destroy(); error ? reject(error) : resolve(); };
    client.setTimeout(10000, () => finish(new Error("APNS_TIMEOUT")));
    client.on("error", finish);
    const request = client.request({ ":method": "POST", ":path": `/3/device/${encodeURIComponent(device.token)}`,
      authorization: `bearer ${token}`, "apns-topic": process.env.APNS_TOPIC, "apns-push-type": "alert", "apns-priority": "10",
      "apns-collapse-id": String(notification._id), "apns-expiration": String(Math.floor(Date.now() / 1000) + 86400),
    });
    let status = 0;
    request.on("response", headers => { status = headers[":status"]; });
    request.on("data", () => {});
    request.on("error", finish);
    request.on("end", () => finish(status === 200 ? null : Object.assign(new Error("APNS_REJECTED"), { status })));
    request.end(JSON.stringify({ aps: { alert: { title: message.title, body: message.body }, sound: "default" }, route: message.route, requestId: message.requestId }));
  });
}

async function dispatchPending(now = new Date()) {
  const User = require("../users/schema");
  for (let index = 0; index < 100; index++) {
    const notification = await Notification.findOneAndUpdate({ pushPending: true, pushNextAttemptAt: { $lte: now },
      $or: [{ pushLeaseUntil: null }, { pushLeaseUntil: { $lte: now } }],
    }, { $set: { pushLeaseUntil: new Date(now.getTime() + 5 * 60000) }, $inc: { pushAttempts: 1 } }, { new: true }).lean();
    if (!notification) break;
    let retry = false;
    try {
      if (notification.type === "checkin_requested") {
        const request = await require("../trainerCheckins/checkin-request-schema").findById(notification.payload?.requestId).lean();
        if (!request || request.status !== "pending" || (request.closesAt && new Date(request.closesAt) <= now)) {
          await Notification.updateOne({ _id: notification._id }, { $set: { pushPending: false, pushLeaseUntil: null } });
          continue;
        }
      }
      const relation = await require("../trainerClients/trainer-client-dao").findActiveByTrainerAndClient(notification.trainerId, notification.clientId);
      const user = relation && await User.findById(notification.clientId).select("auth").lean();
      const devices = user?.auth?.sessionId && (!user.auth.refreshExpiresAt || new Date(user.auth.refreshExpiresAt) > now)
        ? await Device.find({ userId: notification.clientId, sessionId: user.auth.sessionId }).lean() : [];
      for (const device of devices) {
        if ((notification.pushDeliveredDevices || []).some(id => String(id) === String(device._id))) continue;
        try {
          await sendToDevice(device, notification);
          await Notification.updateOne({ _id: notification._id }, { $addToSet: { pushDeliveredDevices: device._id } });
        } catch (error) {
          const unregistered = error.response?.data?.error?.details?.some(detail => detail.errorCode === "UNREGISTERED") || error.status === 410;
          if (unregistered) await Device.deleteOne({ _id: device._id });
          else retry = true;
        }
      }
    } catch { retry = true; }
    await Notification.updateOne({ _id: notification._id }, { $set: {
      pushPending: retry && notification.pushAttempts < 5, pushLeaseUntil: null,
      pushNextAttemptAt: new Date(now.getTime() + 3600000),
    } });
  }
}

module.exports = { configured, messageFor, sendToDevice, dispatchPending };
