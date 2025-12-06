import React, { useState } from 'react';
import { SocketProvider } from './context/SocketContext';
import LeafletMap from './components/LeafletMap';
import Sidebar from './components/Sidebar';
import RequestModal from './components/RequestModal';
import axios from 'axios';

function App() {
  const [selectedLocation, setSelectedLocation] = useState(null); // { lat, lng }
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeDispatches, setActiveDispatches] = useState([]); // Array of { id, path, onComplete }
  const [etaNotifications, setEtaNotifications] = useState([]); // Array of { id, eta, message }
  const [focusedHospital, setFocusedHospital] = useState(null);

  // Callback to remove dispatch when animation completes
  const handleDispatchComplete = (dispatchId) => {
    setActiveDispatches(prev => prev.filter(d => d.id !== dispatchId));
    setEtaNotifications(prev => prev.filter(n => n.id !== dispatchId));
  };

  const handleMapClick = (location) => {
    // location: { lat, lng, id? }
    setSelectedLocation(location);
    setIsModalOpen(true);
  };

  const handleHospitalClick = (hospital) => {
    setFocusedHospital(hospital);
  };

  const handleConfirmRequest = async () => {
    if (!selectedLocation) return;

    setLoading(true);
    try {
      const payload = {
        lat: selectedLocation.lat,
        lng: selectedLocation.lng,
        locationId: selectedLocation.id // Optional
      };


      const res = await axios.post('/api/request', payload);

      const newPath = res.data.path.shortestPath;
      if (newPath) {
        // Add new dispatch to the list
        const dispatchId = Date.now() + Math.random(); // Simple unique ID

        setActiveDispatches(prev => [...prev, {
          id: dispatchId,
          path: newPath,
          onComplete: handleDispatchComplete
        }]);

        setEtaNotifications(prev => [...prev, {
          id: dispatchId,
          eta: res.data.eta,
          message: `Ambulance Dispatched! ETA: ${res.data.eta} mins`
        }]);
      }

      setIsModalOpen(false);
    } catch (err) {
      console.error(err);
      alert("Failed to request ambulance: " + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SocketProvider>
      <div className="flex flex-col lg:flex-row h-screen bg-background overflow-hidden">

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col relative overflow-hidden">
          <header className="bg-white shadow-sm z-10 p-4 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <img src="/assets/ambulance.png" alt="Logo" className="h-8 w-auto" />
              <h1 className="text-xl font-bold text-primary">Ambulance Manager</h1>
            </div>
            {etaNotifications.length > 0 && (
              <div className="flex gap-2 overflow-x-auto max-w-[50vw] pb-1 items-center no-scrollbar">
                {etaNotifications.map(notification => (
                  <div key={notification.id} className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap shadow-sm border border-green-200 flex-shrink-0">
                    {notification.message}
                  </div>
                ))}
              </div>
            )}
          </header>

          <main className="flex-1 overflow-hidden p-4 lg:p-8 flex items-center justify-center bg-gray-50 h-full">
            <div className="w-full h-full shadow-xl rounded-xl overflow-hidden border-4 border-white">
              <LeafletMap
                onMapClick={handleMapClick}
                activeDispatches={activeDispatches}
                focusedHospital={focusedHospital}
              />
            </div>
          </main>
        </div>

        {/* Sidebar */}
        <Sidebar onHospitalClick={handleHospitalClick} />

        {/* Modals */}
        <RequestModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onConfirm={handleConfirmRequest}
          nodeId={selectedLocation ? (selectedLocation.id || "Map Location") : ""}
          loading={loading}
        />

      </div>
    </SocketProvider>
  );
}

export default App;
