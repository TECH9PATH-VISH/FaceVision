#if defined(ESP8266)
  #include <ESP8266WiFi.h>
  #include <Servo.h>
#elif defined(ESP32)
  #include <WiFi.h>
  #include <ESP32Servo.h>
#endif
#include <WebSocketsServer.h>
#include <ArduinoJson.h> // You will need to install ArduinoJson library

// Replace with your network credentials
const char* ssid = "Wokwi-GUEST";
const char* password = "";

// WebSocket server on port 81 (The standard WebSocket port for ESP)
WebSocketsServer webSocket = WebSocketsServer(81);

// Servo setup
Servo panServo;
int servoPin = 4; 
int currentAngle = 90; // Start at center (0-180 degrees)

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
      // Print the raw payload to the Serial Monitor so you can see exactly what it received
      Serial.printf("\n--- RECEIVED RAW WEBSOCKET DATA ---\n");
      Serial.printf("Payload: %s\n", payload);
      Serial.printf("-----------------------------------\n");

      // Parse the JSON payload from the web app
      StaticJsonDocument<200> doc;
      DeserializationError error = deserializeJson(doc, payload);

      if (error) {
        Serial.print("JSON Parse failed: ");
        Serial.println(error.c_str());
        return;
      }

      // Check if it's the "search" command (lost target)
      if (doc.containsKey("status") && doc["status"] == "search") {
        Serial.println("Target lost! Stopping or sweeping...");
        // You could add logic here to slowly sweep the servo left/right to find a face
      } 
      // Check if we have tracking data
      else if (doc.containsKey("target_x")) {
        int offsetX = doc["target_x"];
        Serial.printf("Received X Offset: %d px\n", offsetX);

        // --- SERVO CONTROL LOGIC ---
        // If the face is to the left of the screen (negative offset)
        if (offsetX < -30) { 
          currentAngle += 2; // Move servo left (adjust +/- based on your physical setup)
        } 
        // If the face is to the right of the screen (positive offset)
        else if (offsetX > 30) {
          currentAngle -= 2; // Move servo right
        }

        // Keep angle within physical limits (0 to 180)
        currentAngle = constrain(currentAngle, 0, 180);
        
        // Move the servo
        panServo.write(currentAngle);
      }
      break;
  }
}

void setup() {
  Serial.begin(115200);
  
  // Attach Servo
  panServo.attach(servoPin);
  
  // TEST SWEEP: Move left and right on boot so you can see it working in the simulation
  Serial.println("Testing Servo Motors...");
  panServo.write(0);
  delay(1000);
  panServo.write(180);
  delay(1000);
  panServo.write(90);
  delay(500);
  
  // Connect to Wi-Fi
  Serial.println();
  Serial.print("Connecting to ");
  Serial.println(ssid);
  
  WiFi.begin(ssid, password);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("\nWiFi connected.");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  // Start WebSocket Server
  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  Serial.println("WebSocket server started on port 81");
}

void loop() {
  // Keep WebSocket running
  webSocket.loop();
}
