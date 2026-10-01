/* =========================================================
   Optional TLS for cloud-hosted MySQL (Aiven, Clever Cloud,
   PlanetScale, RDS, DigitalOcean, etc.). Most managed MySQL
   hosts require an encrypted connection; a local MySQL on
   your own machine does not, so this is opt-in via .env.

   DB_SSL=true                      -> encrypt, trust the server's cert
   DB_SSL=true + DB_SSL_CA=/path    -> encrypt, verify against that CA file
   DB_SSL unset / false             -> no encryption (local MySQL)
   ========================================================= */

const fs = require("fs");

function sslConfig() {

    if (String(process.env.DB_SSL).toLowerCase() !== "true") {
        return undefined;
    }

    if (process.env.DB_SSL_CA) {
        return { ca: fs.readFileSync(process.env.DB_SSL_CA, "utf8") };
    }

    // No CA file given: still encrypt the connection, just don't verify
    // the certificate chain. Fine for a student/demo deployment; for a
    // real production system, set DB_SSL_CA to the host's CA certificate
    // instead (Aiven, PlanetScale, etc. all provide one to download).
    return { rejectUnauthorized: false };

}

module.exports = { sslConfig };
