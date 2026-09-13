#include <ESP8266WiFi.h>
#include <PubSubClient.h> // IMPORTANT: Install "PubSubClient" by Nick O'Leary in Library Manager
#include <Servo.h>

// ==========================================
// 1. SET YOUR PHONE'S HOTSPOT CREDENTIALS
// ==========================================
const char* ssid = "log10fury";         // Your phone's hotspot name
const char* password = "c6h6cooh"; // Your phone's hotspot password

// ==========================================
// 2. MQTT BROKER SETTINGS (Free Public Broker)
// ==========================================
const char* mqtt_server = "broker.hivemq.com";
const int mqtt_port = 1883;
// Unique topic for your app. Make sure it matches the topic in script.js!
const char* mqtt_topic = "yantriksha/facevision/servo"; 

WiFiClient espClient;
PubSubClient client(espClient);

Servo myServo;
const int servoPin = D4;
int currentAngle = 90;

// Setup WiFi connection
void setup_wifi() {
  delay(10);
  Serial.println();
  Serial.print("Connecting to Hotspot: ");
  Serial.println(ssid);

  WiFi.mode(WIFI_STA); // Station mode
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("");
  Serial.println("WiFi connected!");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
}

// Handle incoming MQTT messages from the Cloud
void callback(char* topic, byte* payload, unsigned int length) {
  // Convert payload byte array to String
  String message;
  for (int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  
  // Debug output
  // Serial.print("Message arrived on topic: ");
  // Serial.print(topic);
  // Serial.print(". Message: ");
  // Serial.println(message);

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

// Reconnect to MQTT Broker if connection is lost
void reconnect() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    // Create a random client ID
    String clientId = "ESP8266Client-";
    clientId += String(random(0xffff), HEX);
    
    // Attempt to connect
    if (client.connect(clientId.c_str())) {
      Serial.println("connected!");
      // Subscribe to the topic
      client.subscribe(mqtt_topic);
      Serial.print("Subscribed to topic: ");
      Serial.println(mqtt_topic);
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  randomSeed(micros());
  
  myServo.attach(servoPin);
  myServo.write(currentAngle);

  setup_wifi();
  
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  
  // Keep the MQTT connection alive and process incoming messages
  client.loop();
}
