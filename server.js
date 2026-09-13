const WebSocket = require('ws');
const http = require('http'); // We need http to communicate with the ESP8266

// Create a WebSocket server on port 8080 (for the FaceVision web app)
const wss = new WebSocket.Server({ port: 8080 });

// The default IP address of the ESP8266 when it creates its own AP network
const ESP8266_IP = '192.168.4.1';
let currentAngle = 90; // Start the servo at the center

console.log("WebSocket Server running on ws://localhost:8080");
console.log("Waiting for web app to connect...");
console.log(`Make sure your computer is connected to the 'ESP8266_Network' WiFi!`);

wss.on('connection', function connection(ws) {
  console.log("✅ Web App Connected!");
  
  ws.on('message', function incoming(message) {
    // Message from the web app
    const msgString = message.toString();
    // console.log("Received data: %s", msgString); // Uncomment to debug
    
    try {
        const data = JSON.parse(msgString);
        
        // If the web app sends a target_x offset
        if (data.target_x !== undefined) {
            
            // Proportional Control: adjust angle based on face offset
            if (data.target_x > 30) {
                currentAngle -= 2; // Face is right, move servo right
            } else if (data.target_x < -30) {
                currentAngle += 2; // Face is left, move servo left
            }
            
            // Constrain angle between 0 and 180 to protect servo
            if (currentAngle > 180) currentAngle = 180;
            if (currentAngle < 0) currentAngle = 0;
            
            // Send HTTP GET request to the ESP8266 to move the servo
            const url = `http://${ESP8266_IP}/setAngle?value=${currentAngle}`;
            
            http.get(url, (res) => {
                // Consume response data to free up memory
                res.on('data', () => {}); 
            }).on('error', (err) => {
                console.error("❌ Error communicating with ESP8266. Are you connected to 'ESP8266_Network'?");
            });
        }
    } catch (e) {
        // Not a JSON message or parse error
    }
  });

  ws.on('close', () => {
    console.log("❌ Web App Disconnected");
  });
});
