const axios = require("axios");
const jwt = require("jsonwebtoken");
const jwkToPem = require("jwk-to-pem");

const verifyGoogleToken = async (token) => {
  try {
    // Decodificar el encabezado del token para obtener el 'kid'
    const decodedHeader = jwt.decode(token, { complete: true }).header;
    const { kid } = decodedHeader;

    // Obtener las claves públicas de Google
    const publicKeys = await getGooglePublicKey();

    // Buscar la clave pública correspondiente al 'kid'
    const publicKey = publicKeys.find((key) => key.kid === kid);
    if (!publicKey) {
      throw new Error("Clave pública no encontrada para el kid");
    }

    // Convertir la clave pública de JWK a PEM
    const pem = jwkToPem(publicKey);

    // Verificar el token utilizando la clave pública
    jwt.verify(token, pem, { algorithms: ["RS256"] });


    return true; // Token válido
  } catch (error) {
    console.error("Error verificando el token:", error.message);
    throw new Error("Token de Google inválido o expirado");
  }
};

const getGooglePublicKey = async () => {
  try {
    const respuesta = await axios.get(
      "https://www.googleapis.com/oauth2/v3/certs"
    );
    return respuesta.data.keys;
  } catch (error) {
    console.error("Error al obtener las claves públicas de Google:", error);
    throw error;
  }
};

const verifyAppleToken = async (token) => {
  try {
    const decodedHeader = jwt.decode(token, { complete: true }).header;
    const { kid } = decodedHeader;

    const publicKeys = await getApplePublicKey();
    const publicKey = publicKeys.find((key) => key.kid === kid);
    if (!publicKey) {
      throw new Error("Clave pública de Apple no encontrada");
    }

    const pem = jwkToPem(publicKey);
    jwt.verify(token, pem, { algorithms: ["RS256"] });

    return true;
  } catch (error) {
    console.error("Error verificando el token de Apple:", error.message);
    throw new Error("Token de Apple inválido o expirado");
  }
};

const getApplePublicKey = async () => {
  try {
    const respuesta = await axios.get("https://appleid.apple.com/auth/keys");
    return respuesta.data.keys;
  } catch (error) {
    console.error("Error al obtener las claves públicas de Apple:", error);
    throw error;
  }
};

module.exports = { verifyGoogleToken, verifyAppleToken };
