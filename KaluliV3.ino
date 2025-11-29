#include "Adafruit_HX711.h"
#include <ESP32Servo.h>

// HX711 pins
const uint8_t DATA_PIN = 4;
const uint8_t CLOCK_PIN = 5;
Adafruit_HX711 hx711(DATA_PIN, CLOCK_PIN);

// Servo pins and settings
Servo myServo;
const int servoPin = 10;
const int pulseMin = 500;   // 0 degrees
const int pulseMax = 2400;  // 270 degrees

// Balance variables
float scale = -0.002328;
int32_t tareOffset = 0;
float previousWeight = 0;
bool servoTriggered = false;

void setup() {
  Serial.begin(115200);
  while (!Serial) {
    delay(10);
  }

  // Initialize HX711
  hx711.begin();
  performTare();

  // Initialize servo
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
  myServo.setPeriodHertz(50);
  myServo.attach(servoPin, pulseMin, pulseMax);
  delay(1000);

  Serial.println("System ready");
}

void loop() {
  // Read weight
  int32_t raw = hx711.readChannelBlocking(CHAN_A_GAIN_128);
  int32_t net = raw - tareOffset;
  float currentWeight = net * scale;

  // Print weight every 100ms
  static unsigned long lastPrint = 0;
  if (millis() - lastPrint >= 100) {
    Serial.print("Weight: ");
    Serial.print(currentWeight, 1); // One decimal place
    Serial.println(" g");
    lastPrint = millis();
  }

  // Check trigger conditions
  if (!servoTriggered && currentWeight > 5.0f && (currentWeight - previousWeight) > 2.0f) {
    Serial.println("Trigger detected - starting servo routine");
    
    // Continue printing weight during the 2000ms delay
    unsigned long triggerTime = millis();
    while (millis() - triggerTime < 2000) {
      // Read and print weight continuously
      raw = hx711.readChannelBlocking(CHAN_A_GAIN_128);
      net = raw - tareOffset;
      currentWeight = net * scale;
      
      Serial.print("Weight: ");
      Serial.print(currentWeight, 1); // One decimal place
      Serial.println(" g");
      delay(100);
    }
    
    servoTriggered = true; // Set flag after delay
    servoRotation();
    performTare(); // Automatically tare after servo routine
    
    // Reset for next cycle after a short delay
    delay(1000);
    servoTriggered = false;
    Serial.println("Cycle complete - ready for next trigger");
  }

  previousWeight = currentWeight;
  delay(10);
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

void servoRotation() {
  // Reset servo to 0deg (500μs) at the start
  myServo.writeMicroseconds(500);
  delay(500);
  
  // Rotate to 180° in 30° increments (6 steps)
  for(int i = 0; i <= 6; i++) {
    int targetAngle = i * 30;
    int pulseWidth = 500 + (targetAngle * 1900) / 270;
    myServo.writeMicroseconds(pulseWidth);
    delay(500);
  }
  
  // Rotate back to 0° in -30° increments (6 steps)
  for(int i = 6; i >= 0; i--) {
    int targetAngle = i * 30;
    int pulseWidth = 500 + (targetAngle * 1900) / 270;
    myServo.writeMicroseconds(pulseWidth);
    delay(500);
  }
  
  delay(1000);
  
  // Rotate from 500 to 800 pulse width, repeat twice
  for(int i = 0; i < 2; i++) {
    myServo.writeMicroseconds(500);
    delay(500);
    myServo.writeMicroseconds(800);
    delay(1000);
  }
  myServo.writeMicroseconds(500);
}