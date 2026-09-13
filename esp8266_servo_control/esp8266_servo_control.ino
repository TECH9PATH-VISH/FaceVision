#include <ESP8266WiFi.h>
#include <WebSocketsServer.h> // IMPORTANT: Install "WebSockets" by Markus Sattler in Library Manager
#include <Servo.h>

// ==========================================
// 1. SET YOUR ESP8266 WIFI CREDENTIALS
// ==========================================
// This is the network your ESP will CREATE. Connect your phone to this!
const char* ssid = "FaceVision_ESP";
const char* password = "password123"; // Must be at least 8 characters

WebSocketsServer webSocket = WebSocketsServer(81);

Servo myServo;
const int servoPin = D4;
int currentAngle = 90;

void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.printf("[%u] Disconnected!\n", num);
      break;
    case WStype_CONNECTED:
      {
        IPAddress ip = webSocket.remoteIP(num);
        Serial.printf("[%u] Connected from %d.%d.%d.%d url: %s\n", num, ip[0], ip[1], ip[2], ip[3], payload);
      }
      break;
    case WStype_TEXT:
      {
        // Convert payload to String
        String message = "";
        for(size_t i = 0; i < length; i++) {
          message += (char)payload[i];
        }
        
        // We are expecting a JSON-like string: {"target_x": <offset>}
        if (message.indexOf("\"target_x\"") > 0) {
          int colonIndex = message.indexOf(':');
          int bracketIndex = message.indexOf('}');
          
          if (colonIndex > 0 && bracketIndex > colonIndex) {
            String valStr = message.substring(colonIndex + 1, bracketIndex);
            int target_x = valStr.toInt(); // Pixel offset from the web app

            // Simple Proportional Control
            if (target_x > 30) {
              currentAngle -= 2; // Move Right
            } else if (target_x < -30) {
              currentAngle += 2; // Move Left
            }

            // Constrain the angle
            if (currentAngle > 180) currentAngle = 180;
            if (currentAngle < 0) currentAngle = 0;

            myServo.write(currentAngle);
          }
        }
      }
      break;
  }
}

void setup() {
  Serial.begin(115200);
  
  myServo.attach(servoPin);
  myServo.write(currentAngle);

  // Setup WiFi Access Point
  Serial.println();
  Serial.print("Configuring Access Point...");
  WiFi.mode(WIFI_AP);
  WiFi.softAP(ssid, password);
  
  IPAddress myIP = WiFi.softAPIP();
  Serial.print("AP IP address: ");
  Serial.println(myIP); // Usually 192.168.4.1

  // Start WebSocket Server
  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  Serial.println("WebSocket server started on port 81");
}

void loop() {
  webSocket.loop();
}
