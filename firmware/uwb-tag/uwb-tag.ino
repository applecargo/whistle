#include <Arduino.h>
#include <Adafruit_SSD1306.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <Wire.h>
#include "network.local.h"

HardwareSerial uwb(2);
WiFiUDP udp;
Adafruit_SSD1306 display(128, 64, &Wire, -1);
bool hasDisplay;
IPAddress receiver;
char line[512];
size_t length;
bool overflow;
uint32_t sent;
unsigned long lastDisplay;

void forwardLine() {
  if (overflow || length < 9 || memcmp(line, "AT+RANGE=", 9) != 0) return;
  const auto bytes = reinterpret_cast<const uint8_t *>(line);
  if (Serial.availableForWrite() >= int(length)) Serial.write(bytes, length);
  if (WiFi.status() != WL_CONNECTED || !udp.beginPacket(receiver, 5195)) return;
  if (udp.write(bytes, length) == length && udp.endPacket()) ++sent;
}

void setup() {
  Serial.setTxBufferSize(2048);
  Serial.begin(115200);
  pinMode(16, OUTPUT_OPEN_DRAIN);
  digitalWrite(16, HIGH);
  uwb.setRxBufferSize(8192);
  uwb.begin(115200, SERIAL_8N1, 18, 17);
  Wire.begin(39, 38);
  hasDisplay = display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  receiver.fromString(WHISTLE_RECEIVER_IP);
  WiFi.setHostname("whistle-t0");
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  WiFi.begin(WHISTLE_WIFI_SSID, WHISTLE_WIFI_PASSWORD);
}

void loop() {
  while (uwb.available()) {
    const char c = uwb.read();
    if (length < sizeof(line)) line[length++] = c;
    else overflow = true;
    if (c == '\n') {
      forwardLine();
      length = 0;
      overflow = false;
    }
  }
  if (hasDisplay && millis() - lastDisplay >= 1000) {
    lastDisplay = millis();
    display.clearDisplay();
    display.setCursor(0, 0);
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(2);
    display.println("T0");
    display.setTextSize(1);
    display.println(WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "WiFi connecting");
    display.println(WHISTLE_RECEIVER_IP ":5195");
    display.printf("UDP sent %lu", (unsigned long)sent);
    display.display();
  }
  delay(1);
}
