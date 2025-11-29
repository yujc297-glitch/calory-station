#include "Adafruit_HX711.h"
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>

// HX711 pins
const uint8_t DATA_PIN = 15;
const uint8_t CLOCK_PIN = 7;
Adafruit_HX711 hx711(DATA_PIN, CLOCK_PIN);

// RGB LED pins (Common Anode - use PWM to control brightness)
const int RED_PIN = 4;
const int GREEN_PIN = 5;
const int BLUE_PIN = 6;

// Balance variables
float scale = 0.002300;
int32_t tareOffset = 0;
float currentWeight = 0.0;

// BLE Configuration
#define SERVICE_UUID        "12345678-1234-5678-1234-56789abcdef0"
#define CHARACTERISTIC_UUID "12345678-1234-5678-1234-56789abcdef1"

BLEServer* pServer = nullptr;
BLECharacteristic* pCharacteristic = nullptr;
bool deviceConnected = false;
bool oldDeviceConnected = false;

// Timing variables
unsigned long lastUpdateTime = 0;
const unsigned long UPDATE_INTERVAL = 1000; // Update every 1 second

// Function declarations - placed BEFORE the classes that use them
void performTare();
void sendWeightData();
void updateLEDColor(float weight);

class MyServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    deviceConnected = true;
    Serial.println("Client connected");
  }

  void onDisconnect(BLEServer* pServer) override {
    deviceConnected = false;
    Serial.println("Client disconnected");
  }
};

class MyCharacteristicCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pChar) override {
    std::string rxValueStd = pChar->getValue();
    
    if (rxValueStd.length() == 0) {
      return;
    }

    // Convert std::string to Arduino String
    String rxValue = String(rxValueStd.c_str());

    Serial.print("Received command: ");
    Serial.println(rxValue);

    // Check if the command is "get_data"
    if (rxValue == "get_data") {
      sendWeightData();
    }
    // Add tare command
    else if (rxValue == "tare") {
      performTare();
      sendWeightData(); // Send updated data after tare
    }
    else {
      Serial.println("Unknown command");
    }
  }
};

void setup() {
  Serial.begin(115200);
  while (!Serial) {
    delay(10);
  }

  // Initialize RGB LED pins
  pinMode(RED_PIN, OUTPUT);
  pinMode(GREEN_PIN, OUTPUT);
  pinMode(BLUE_PIN, OUTPUT);
  
  // Turn off LED initially (common anode - HIGH turns off)
  digitalWrite(RED_PIN, HIGH);
  digitalWrite(GREEN_PIN, HIGH);
  digitalWrite(BLUE_PIN, HIGH);

  Serial.println("Starting ESP32-S3 Balance with BLE and RGB LED");

  // Initialize HX711
  hx711.begin();
  performTare();

  // Initialize BLE
  BLEDevice::init("ESP32S3-Balance");  // advertised name

  // Create server & callbacks
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  // Create service
  BLEService* pService = pServer->createService(SERVICE_UUID);

  // Create characteristic (read + write + notify)
  pCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_WRITE |
    BLECharacteristic::PROPERTY_NOTIFY
  );

  // CCCD descriptor for notifications
  pCharacteristic->addDescriptor(new BLE2902());
  pCharacteristic->setCallbacks(new MyCharacteristicCallbacks());
  pCharacteristic->setValue("Balance Ready");

  // Start service & advertising
  pService->start();
  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.println("BLE Balance Server Ready");
  Serial.println("Send 'get_data' command to receive weight data");
  Serial.println("Send 'tare' command to zero the balance");
}

void performTare() {
  Serial.println("Taring...");
  
  int64_t sum = 0;
  for (uint8_t t = 0; t < 10; t++) {
    sum += hx711.readChannelRaw(CHAN_A_GAIN_128);
    delay(100);
  }

  tareOffset = sum / 10;
  Serial.println("Tare complete");
}

void sendWeightData() {
  // Create JSON string with only the weight value
  String jsonData = "{";
  jsonData += "\"float_value\":";
  jsonData += String(currentWeight, 1); // 1 decimal place
  jsonData += "}";

  Serial.print("Sending data: ");
  Serial.println(jsonData);

  // Send back the JSON data
  pCharacteristic->setValue(jsonData.c_str());

  // Notify browser
  if (deviceConnected) {
    pCharacteristic->notify();
  }
}

void updateLEDColor(float weight) {
  int red, green, blue;
  
  if (weight < 5.0) {
    // White for weights below 5g
    red = 0;    // LOW for common anode (turns on)
    green = 0;
    blue = 0;
  } else if (weight <= 200.0) {
    // Blue to Green transition (5g - 200g)
    float ratio = (weight - 5.0) / 195.0; // 0 to 1
    red = 255;
    green = 255 - (int)(ratio * 255);
    blue = 255 - (int)(ratio * 255);
  } else if (weight <= 400.0) {
    // Green to Yellow transition (200g - 400g)
    float ratio = (weight - 200.0) / 200.0; // 0 to 1
    red = 255 - (int)(ratio * 255);
    green = 0;
    blue = 255;
  } else if (weight <= 600.0) {
    // Yellow to Orange transition (400g - 600g)
    float ratio = (weight - 400.0) / 200.0; // 0 to 1
    red = 0;
    green = (int)(ratio * 128);
    blue = 255;
  } else if (weight <= 800.0) {
    // Orange to Red transition (600g - 800g)
    float ratio = (weight - 600.0) / 200.0; // 0 to 1
    red = 0;
    green = 128 + (int)(ratio * 127);
    blue = 255;
  } else {
    // Red for weights above 800g
    red = 0;
    green = 255;
    blue = 255;
  }
  
  // For common anode, we invert the values (255 = off, 0 = full brightness)
  analogWrite(RED_PIN, red);
  analogWrite(GREEN_PIN, green);
  analogWrite(BLUE_PIN, blue);
  
  Serial.print("LED Color - R:");
  Serial.print(255-red);
  Serial.print(" G:");
  Serial.print(255-green);
  Serial.print(" B:");
  Serial.print(255-blue);
  Serial.println();
}

void loop() {
  // Read weight
  int32_t raw = hx711.readChannelBlocking(CHAN_A_GAIN_128);
  int32_t net = raw - tareOffset;
  currentWeight = net * scale;

  // Update LED color based on weight
  updateLEDColor(currentWeight);

  // Send data periodically when connected
  unsigned long currentTime = millis();
  if (deviceConnected && (currentTime - lastUpdateTime >= UPDATE_INTERVAL)) {
    sendWeightData();
    lastUpdateTime = currentTime;
  }

  // Handle BLE connection status
  if (!deviceConnected && oldDeviceConnected) {
    delay(500); // give the bluetooth stack the chance to get things ready
    pServer->startAdvertising(); // restart advertising
    Serial.println("Start advertising");
    oldDeviceConnected = deviceConnected;
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
  }

  // Print to serial for debugging
  static unsigned long lastSerialPrint = 0;
  if (currentTime - lastSerialPrint >= 1000) {
    Serial.print("Weight: ");
    Serial.print(currentWeight, 1);
    Serial.println(" g");
    lastSerialPrint = currentTime;
  }

  delay(100);
}