console.log("Page loaded:", Date.now());
window.addEventListener("beforeunload", () => {
  console.warn("Page is reloading.");
});



const getApiBaseUrl = () => {
  return "https://qhmqmh-ip-59-98-39-192.tunnelmole.net" + "/api"; // Change this to your backend API URL if different
};

const API_URL = getApiBaseUrl();
let touristId = null;
let watchId = null;
let debugTimer = null;

// Browsers cannot reliably distinguish laptops from desktops. Treat desktop-class
// devices as laptops for this opt-in location simulation.
const isLaptop = () => {
  const isMobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const hasFinePointer = window.matchMedia?.("(pointer: fine)").matches ?? false;
  return !isMobileUserAgent && hasFinePointer && window.innerWidth >= 768;
};

const DEBUG_MODE = true; // Set to false to disable simulated locations and use GPS/errors.

document.getElementById("registrationForm").addEventListener("submit", registerTourist);
document.getElementById("panicBtn").addEventListener("click", activatePanicButton);

async function registerTourist(event) {
  event.preventDefault();

  const data = {
    name: valueOf("name"),
    passport: valueOf("passport"),
    phone: valueOf("phone"),
    checkinDate: valueOf("checkinDate"),
    checkoutDate: valueOf("checkoutDate"),
    itinerary: valueOf("itinerary"),
    emergencyContact: valueOf("emergencyContact")
  };

  if (Object.values(data).some(v => !v)) {
    alert("Please fill in all fields");
    return;
  }

  try {
    const res = await fetch(`${API_URL}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const result = await res.json();

    if (result.success) {
      touristId = result.touristId;
      showTrackingView(data.name, touristId, result.safetyScore);
      startTracking();
      alert("Registration successful.");
    } else {
      alert(`Registration failed: ${result.error}`);
    }
  } catch (err) {
    console.error("Registration error:", err);
    alert("Failed to connect to server. Please try again.");
  }
}

function valueOf(id) {
  return document.getElementById(id).value.trim();
}

function showTrackingView(name, id, safetyScore) {
  document.getElementById("registrationView").classList.add("hidden");
  document.getElementById("trackingView").classList.remove("hidden");
  document.getElementById("touristName").textContent = name;
  document.getElementById("touristIdDisplay").textContent = id;
  updateSafetyScore(safetyScore, null);
}

function updateSafetyScore(safetyScore, scoreFactors) {
  document.getElementById("safetyScore").textContent = safetyScore === '' || safetyScore === null || safetyScore === undefined
    ? "Safety score: awaiting first location"
    : `Safety score: ${safetyScore}/100`;
  if (scoreFactors?.explanation) {
    document.getElementById("scoreFactorText").textContent = scoreFactors.explanation;
  }
}

function startTracking() {
  const useSimulatedLocation = DEBUG_MODE && (isLaptop() || !navigator.geolocation);
  if (!useSimulatedLocation && !navigator.geolocation) {
    throw new Error("Geolocation is not supported in this browser.");
  }

  document.getElementById("gpsStatus").textContent = useSimulatedLocation ? "Debug (simulated)" : "Active";
  document.getElementById("trackingStatus").textContent = "Active";

  if (useSimulatedLocation) {
    startDebugTracking();
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      sendLocation({ lat, lng });
    },
    (err) => {
      console.error("Geolocation error:", err);
      if (DEBUG_MODE) {
        startDebugTracking();
        return;
      }

      document.getElementById("gpsStatus").textContent = "Error";
      throw new Error("Unable to determine location.", { cause: err });
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 5000 }
  );
}

function randomLocation() {
  return {
    lat: Math.random() * 180 - 90,
    lng: Math.random() * 360 - 180
  };
}

function startDebugTracking() {
  if (debugTimer !== null) return;

  console.info("Using random coordinates in debug mode.");
  document.getElementById("gpsStatus").textContent = "Debug (simulated)";
  sendLocation({ ...randomLocation(), simulated: true });
  debugTimer = window.setInterval(() => sendLocation({ ...randomLocation(), simulated: true }), 5000);
}

async function sendLocation({ lat, lng, simulated = false }) {
  document.getElementById("currentLocation").textContent =
    `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;

  try {
    const res = await fetch(`${API_URL}/location`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ touristId, lat, lng, timestamp: Date.now(), simulated })
    });
    const result = await res.json();
    if (Number.isFinite(Number(result.safetyScore))) {
      updateSafetyScore(result.safetyScore, result.scoreFactors);
    }
    if (result.alertCreated) alert("A safety alert was generated for your current location.");
  } catch (err) {
    console.error("Location send failed:", err);
  }
}

async function activatePanicButton() {
  if (!touristId) {
    alert("Please register first.");
    return;
  }
  if (!confirm("Send an emergency alert now?")) return;

  const useSimulatedLocation = DEBUG_MODE && (isLaptop() || !navigator.geolocation);
  const sendPanicAlert = async ({ lat, lng, simulated = false }) => {
    try {
      const res = await fetch(`${API_URL}/panic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ touristId, lat, lng, simulated })
      });
      const result = await res.json();
      if (result.success) {
        if (Number.isFinite(Number(result.safetyScore))) {
          updateSafetyScore(result.safetyScore, result.scoreFactors);
        }
        alert("Emergency alert sent.");
      }
      else alert("Failed to send alert!");
    } catch (err) {
      alert("Failed to contact server. Call emergency services.");
    }
  };

  if (useSimulatedLocation) {
    await sendPanicAlert({ ...randomLocation(), simulated: true });
    return;
  }

  if (!navigator.geolocation) {
    if (DEBUG_MODE) {
      await sendPanicAlert({ ...randomLocation(), simulated: true });
      return;
    }

    throw new Error("Geolocation is unavailable. Cannot send panic alert coordinates.");
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => sendPanicAlert({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    (err) => {
      console.error("Panic location error:", err);
      if (DEBUG_MODE) {
        sendPanicAlert({ ...randomLocation(), simulated: true });
        return;
      }

      throw new Error("Unable to determine location for panic alert.", { cause: err });
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 5000 }
  );
}


// document.addEventListener('contextmenu', e => e.preventDefault());