---

# Ambulance Management and Routing System

The **Ambulance Management and Routing System** is a web application designed to assist in dispatching ambulances based on geographical location and availability. It features a map-based interface, hospital availability tracking, shortest path calculation for ambulances, and real-time updates on ambulance dispatch status.

## Features

- **Map-Based Interface**: Visual representation of areas that can request ambulances.
- **Hospital and Ambulance Availability**: Track the number of ambulances available at each hospital.
- **Shortest Path Calculation**: Uses Dijkstra's algorithm to find the nearest hospital with available ambulances.
- **Real-Time Ambulance Dispatch**: Track the estimated time of arrival and route taken by the ambulance.
- **Data Visualization**: Real-time charts to show hospital availability and road occupancy levels.

## Technologies Used

- **Frontend**: HTML, CSS, JavaScript
- **Chart Library**: [Chart.js](https://www.chartjs.org/) for visualizing data.
- **Algorithms**: Dijkstra's Algorithm for shortest path calculation.
- **Dependencies**: jQuery for DOM manipulation.

## Getting Started

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/ambulance-management-system.git
   cd ambulance-management-system
   ```

2. Open `index.html` in a browser to view the application:

   ```bash
   open index.html
   ```

### Project Structure

- **index.html**: Main HTML file with map areas for ambulance requests.
- **style.css**: CSS for styling the map, tables, and cards.
- **maad.js**: JavaScript file with the main logic for dispatching ambulances, finding the shortest path, and updating hospital data.
- **assets**: Directory for images, such as the ambulance icons and hospital markers.

### Usage

1. **Requesting an Ambulance**: Click on an area on the map to request an ambulance. 
2. **Viewing ETA and Path**: After the request, the estimated time and route will be displayed.
3. **Real-Time Data**: View the number of ambulances available per hospital and road occupancy status in the sidebar.

## Code Overview

### Core Functions in `maad.js`

- **findNearestHospital(nodeId)**: Finds the nearest hospital with an available ambulance.
- **requestAmbulance(nodeId)**: Initiates the ambulance request process, dispatches the ambulance, and updates availability.
- **dijkstra(edges, startNode, endNode)**: Implements Dijkstra’s algorithm to find the shortest path from the requested node to the hospital.
- **calculateEstimatedTime(result)**: Calculates the estimated time of arrival based on distance and road occupancy.

## Improvements and Future Enhancements

1. **Enhanced UI**: Improve responsiveness and mobile support.
2. **Database Integration**: Store hospital and ambulance data in a backend database for real-time updates.
3. **Live Location Tracking**: Integrate live tracking for ambulances on the map.
4. **Notification System**: Add notifications for hospital staff on new requests.

## Contributing

1. Fork the repository.
2. Create a new branch for your feature (`git checkout -b feature-name`).
3. Commit your changes (`git commit -m 'Add feature name'`).
4. Push to the branch (`git push origin feature-name`).
5. Open a Pull Request.

## License

Distributed under the MIT License. See `LICENSE` for more information.

## Contact

For questions, please contact [b.sai.sannidh@gmail.com](mailto:b.sai.sannidh@gmail.com) or open an issue on the repository.

---
