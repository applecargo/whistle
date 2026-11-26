#include <Arduino.h>
#include <algorithm>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <Preferences.h>
#include <Wire.h>
#include <Adafruit_SSD1306.h>
#include "network.local.h"

#ifndef WHISTLE_NETWORK_ROUTER
#error "Generate router settings with npm run uwb:setup-network before building."
#endif

HardwareSerial uwb(2);
WebServer server(80);
Preferences preferences;
Adafruit_SSD1306 display(128, 64, &Wire, -1);
bool hasDisplay = false;
int anchorId = -1;
String state = "boot", session, result, pendingLine;
String cfg, ant, cap, rpt, pan, power;
bool queued = false, collecting = false;
String usbLine;
uint16_t samples[4][1000];
size_t counts[4] = {};
int lastSequence = -1;
unsigned long retryAt = 0;
String shownIp;
String hostname;
bool mdnsStarted = false, shownConnected = false;
unsigned long mdnsRetryAt = 0;

String escaped(String s) {
  s.replace("\\", "\\\\"); s.replace("\"", "\\\""); s.replace("\r", ""); s.replace("\n", " ");
  return "\"" + s + "\"";
}

void showState() {
  Serial.printf("A%d %s\n", anchorId, state.c_str());
  shownConnected = WiFi.status() == WL_CONNECTED;
  shownIp = WiFi.localIP().toString();
  Serial.printf("WiFi connected=%d status=%d ip=%s\n", shownConnected, WiFi.status(), shownIp.c_str());
  if (!hasDisplay) return;
  display.clearDisplay(); display.setTextColor(SSD1306_WHITE); display.setCursor(0, 0);
  display.setTextSize(2); display.printf("A%d\n", anchorId);
  display.setTextSize(1); display.println(state);
  display.println(shownConnected ? "WiFi connected" : "WiFi connecting");
  display.println(shownIp);
  display.display();
}

void updateNetwork() {
  bool connected = WiFi.status() == WL_CONNECTED;
  if (!connected && mdnsStarted) { MDNS.end(); mdnsStarted = false; }
  if (connected && !mdnsStarted && millis() - mdnsRetryAt >= 5000) {
    mdnsRetryAt = millis();
    mdnsStarted = MDNS.begin(hostname.c_str());
    if (mdnsStarted) {
      MDNS.addService("http", "tcp", 80);
      MDNS.addServiceTxt("http", "tcp", "device", "whistle-anchor");
      MDNS.addServiceTxt("http", "tcp", "id", String(anchorId));
    }
  }
  if (shownConnected != connected || shownIp != WiFi.localIP().toString()) showState();
}

void recordRange(const String &line) {
  int tag, seq, d[8], ids[8]; unsigned mask;
  int fields = sscanf(line.c_str(), "AT+RANGE=tid:%d,mask:%x,seq:%d,range:(%d,%d,%d,%d,%d,%d,%d,%d),ancid:(%d,%d,%d,%d,%d,%d,%d,%d)",
    &tag, &mask, &seq, &d[0], &d[1], &d[2], &d[3], &d[4], &d[5], &d[6], &d[7],
    &ids[0], &ids[1], &ids[2], &ids[3], &ids[4], &ids[5], &ids[6], &ids[7]);
  if (fields != 19 || tag != 0 || seq == lastSequence) return;
  lastSequence = seq;
  for (int i = 0; i < 8; i++) {
    int id = ids[i];
    if ((mask & (1U << i)) && id >= 0 && id < 4 && id != anchorId && d[i] > 0 && d[i] <= 50000 && counts[id] < 1000)
      samples[id][counts[id]++] = d[i];
  }
}

bool readLine(String &line) {
  while (uwb.available()) {
    char c = uwb.read();
    if (c == '\r') continue;
    if (c == '\n') {
      line = pendingLine; pendingLine = "";
      if (line.startsWith("AT+RANGE=")) { if (collecting) recordRange(line); }
      else if (line.length()) Serial.println(line);
      return true;
    }
    if (pendingLine.length() < 1024) pendingLine += c;
    else pendingLine = "";
  }
  return false;
}

String command(const String &cmd, const String &prefix, unsigned long timeout = 1200) {
  for (int attempt = 0; attempt < 5; attempt++) {
    if (attempt) delay(17 + esp_random() % 41);
    String line; while (readLine(line)) {}
    pendingLine = ""; Serial.println("TX " + cmd); uwb.println(cmd);
    unsigned long started = millis();
    while (millis() - started < timeout) {
      if (readLine(line) && line.startsWith(prefix)) {
        String matched = line;
        while (millis() - started < 900) { String extra; while (readLine(extra)) {} delay(1); }
        return matched;
      }
      delay(1);
    }
  }
  return "";
}

String query(const char *key) {
  String prefix = String("AT+") + key + "=";
  String line = command(String("AT+") + key + "?", prefix);
  return line.startsWith(prefix) ? line.substring(prefix.length()) : "";
}

bool readSettings() {
  cfg = query("GETCFG"); ant = query("GETANT"); cap = query("GETCAP");
  rpt = query("GETRPT"); pan = query("GETPAN"); power = query("GETPOW");
  return cfg.length() && ant.length() && cap.length() && rpt.length() && pan.length() && power.length();
}

bool setRole(const String &value, bool tag) {
  if (!command("AT+SETCFG=" + value, "OK").length()) return false;
  if (!command("AT+SAVE", "OK").length()) return false;
  String boot = tag ? "Tag start run, Id:0," : String("Anc start run, Id:") + anchorId + ",";
  Serial.println("UWB RESET GPIO16");
  String line;
  while (readLine(line)) {}
  digitalWrite(16, LOW);
  unsigned long resetAt = millis();
  while (millis() - resetAt < 3200) { while (readLine(line)) {} delay(1); }
  digitalWrite(16, HIGH);
  bool running = false;
  unsigned long started = millis();
  while (millis() - started < 8000) {
    if (readLine(line) && line.startsWith(boot)) { running = true; break; }
    delay(1);
  }
  if (!running) return false;
  delay(300);
  return query("GETCFG") == value;
}

bool restoreRole() {
  String original = preferences.getString("original", "");
  if (!original.length()) return true;
  state = "restoring"; showState();
  bool verified = false;
  for (int attempt = 0; attempt < 2 && !verified; attempt++) {
    if (setRole(original, false)) verified = readSettings() && cfg == original;
    if (!verified) delay(1000);
  }
  if (!verified) { state = "restore-error"; showState(); return false; }
  if (!preferences.remove("original")) { state = "restore-error"; showState(); return false; }
  return true;
}

bool authorized() {
  if (server.header("X-Whistle-Key") == WHISTLE_CONTROL_KEY) return true;
  server.send(401, "application/json", "{\"error\":\"key required\"}"); return false;
}

void sendStatus() {
  if (!authorized()) return;
  if (!readSettings()) state = "query-error";
  server.send(200, "application/json", String("{\"id\":") + anchorId + ",\"state\":" + escaped(state)
    + ",\"session\":" + escaped(session) + ",\"cfg\":" + escaped(cfg) + ",\"ant\":" + escaped(ant)
    + ",\"cap\":" + escaped(cap) + ",\"rpt\":" + escaped(rpt) + ",\"pan\":" + escaped(pan) + ",\"pow\":" + escaped(power)
    + ",\"network\":\"router\",\"hostname\":" + escaped(hostname) + ",\"ip\":" + escaped(WiFi.localIP().toString()) + "}");
}

void measure() {
  queued = false; result = "";
  String error;
  bool backedUp = false, restored = false;
  String originalCfg, originalAnt, originalCap, originalRpt, originalPan, originalPower;
  if (!readSettings() || !cfg.startsWith(String(anchorId) + ",1,") || rpt != "1") error = "anchor settings unavailable";
  else {
    originalCfg = cfg; originalAnt = ant; originalCap = cap; originalRpt = rpt; originalPan = pan; originalPower = power;
    backedUp = preferences.putString("original", originalCfg) == originalCfg.length();
    if (!backedUp) error = "backup failed";
  }
  memset(counts, 0, sizeof(counts)); lastSequence = -1;
  if (!error.length()) {
    state = "measuring"; showState();
    String temporary = "0,0," + originalCfg.substring(originalCfg.indexOf(',', originalCfg.indexOf(',') + 1) + 1);
    if (!setRole(temporary, true)) error = "temporary tag start failed";
    else {
      collecting = true;
      unsigned long start = millis();
      while (millis() - start < 10000) { String line; while (readLine(line)) {} delay(1); }
      collecting = false;
    }
  }
  if (backedUp) {
    restored = restoreRole();
    if (restored) restored = cfg == originalCfg && ant == originalAnt && cap == originalCap && rpt == originalRpt && pan == originalPan && power == originalPower;
  }
  if (!restored && !error.length()) error = "restore verification failed";
  state = restored ? "idle" : "restore-error"; showState();
  result = String("{\"id\":") + anchorId + ",\"session\":" + escaped(session) + ",\"restored\":" + (restored ? "true" : "false") + ",\"error\":" + escaped(error) + ",\"readings\":[";
  bool first = true;
  for (int id = 0; id < 4; id++) if (id != anchorId) {
    if (!first) result += ','; first = false;
    size_t n = counts[id];
    std::sort(samples[id], samples[id] + n);
    float median = n ? (samples[id][(n - 1) / 2] + samples[id][n / 2]) / 200.0f : 0;
    result += String("{\"from\":") + anchorId + ",\"to\":" + id + ",\"samples\":" + n
      + ",\"median\":" + String(median, 3) + ",\"p10\":" + String(n ? samples[id][(n - 1) / 10] / 100.0f : 0, 3)
      + ",\"p90\":" + String(n ? samples[id][(n - 1) * 9 / 10] / 100.0f : 0, 3) + "}";
  }
  result += "]}";
}

void setup() {
  Serial.begin(250000);
  pinMode(16, OUTPUT_OPEN_DRAIN); digitalWrite(16, HIGH);
  uwb.setRxBufferSize(8192); uwb.begin(115200, SERIAL_8N1, 18, 17);
  Wire.begin(39, 38); hasDisplay = display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  preferences.begin("whistle-survey", false);
  delay(2000);
  String original = preferences.getString("original", "");
  cfg = original.length() ? original : query("GETCFG");
  int role, rate, filter;
  if (sscanf(cfg.c_str(), "%d,%d,%d,%d", &anchorId, &role, &rate, &filter) != 4 || role != 1 || anchorId < 0 || anchorId > 3) {
    state = "invalid anchor ID"; showState(); anchorId = -1; return;
  }
  if (original.length() && !restoreRole()) { state = "restore-error"; }
  else state = readSettings() ? "idle" : "query-error";
  hostname = "whistle-a" + String(anchorId);
  WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
    Serial.printf("WiFi disconnected reason=%u\n", info.wifi_sta_disconnected.reason);
  }, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
  WiFi.setHostname(hostname.c_str());
  WiFi.mode(WIFI_STA); WiFi.setSleep(false); WiFi.setAutoReconnect(true);
  if (WHISTLE_WIFI_PASSWORD[0] == '\0') {
    WiFi.setMinSecurity(WIFI_AUTH_OPEN);
    WiFi.begin(WHISTLE_WIFI_SSID);
  } else {
    WiFi.begin(WHISTLE_WIFI_SSID, WHISTLE_WIFI_PASSWORD);
  }
  const char *headers[] = {"X-Whistle-Key"}; server.collectHeaders(headers, 1);
  server.on("/status", HTTP_GET, sendStatus);
  server.on("/measure", HTTP_POST, []() {
    if (!authorized()) return;
    String incoming = server.arg("plain");
    if (incoming.length() != 36) { server.send(400, "application/json", "{\"error\":\"session required\"}"); return; }
    if (incoming == session) { server.send(200, "application/json", "{\"accepted\":true}"); return; }
    if (state != "idle" || preferences.isKey("original")) { server.send(409, "application/json", "{\"error\":\"not idle\"}"); return; }
    session = incoming; state = "queued"; queued = true; result = "";
    server.send(202, "application/json", "{\"accepted\":true}");
  });
  server.on("/result", HTTP_GET, []() {
    if (!authorized()) return;
    if (server.arg("session") != session || !result.length()) { server.send(404, "application/json", "{\"error\":\"result unavailable\"}"); return; }
    server.send(200, "application/json", result);
  });
  server.begin(); showState();
}

void loop() {
  if (anchorId < 0 || anchorId > 3) { delay(100); return; }
  server.handleClient();
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      usbLine.trim();
      if (usbLine == "STATUS") {
        readSettings();
        Serial.println("STATUS " + cfg + " " + state);
      } else if (usbLine == "NETWORK") {
        Serial.printf("NETWORK id=%d status=%d connected=%d ip=%s mdns=%d\n", anchorId, WiFi.status(), WiFi.status() == WL_CONNECTED, WiFi.localIP().toString().c_str(), mdnsStarted);
      } else if (usbLine == "RESULT") {
        Serial.println(result.length() ? result : "NO RESULT");
      } else if (usbLine.startsWith("MEASURE ") && usbLine.length() == 44 && state == "idle" && !preferences.isKey("original")) {
        session = usbLine.substring(8); queued = true; state = "queued";
      }
      usbLine = "";
    } else if (usbLine.length() < 128) usbLine += c;
  }
  if (queued) { measure(); Serial.println(result); }
  if (state == "restore-error" && preferences.isKey("original") && millis() - retryAt > 5000) {
    retryAt = millis(); if (restoreRole() && readSettings()) { state = "idle"; showState(); }
  }
  String line; while (readLine(line)) {}
  updateNetwork();
  delay(1);
}
