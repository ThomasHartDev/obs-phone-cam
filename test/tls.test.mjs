import { test } from "node:test";
import assert from "node:assert/strict";
import {
  certHostnames,
  pemToDerB64,
  buildMobileConfig,
} from "../tls.mjs";

test("cert hostnames always include localhost and unique IPs", () => {
  const names = certHostnames(["192.168.0.37", "192.168.0.37", "127.0.0.1"]);
  assert.ok(names.includes("localhost"));
  assert.ok(names.includes("192.168.0.37"));
  assert.equal(names.filter((n) => n === "192.168.0.37").length, 1);
});

test("mobileconfig wraps the CA as an iOS root payload", () => {
  const pem = `-----BEGIN CERTIFICATE-----
MIIB
-----END CERTIFICATE-----`;
  const xml = buildMobileConfig(pem);
  assert.ok(xml.includes("com.apple.security.root"));
  assert.ok(xml.includes("Phone Cam"));
  assert.ok(xml.includes(pemToDerB64(pem)));
  assert.equal(pemToDerB64(pem), "MIIB");
});
