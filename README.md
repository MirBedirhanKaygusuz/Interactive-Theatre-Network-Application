# Interactive Theatre Audience Selection System (MVP)

A local network-based web application designed for live theatre performances that enables real-time audience interaction without requiring internet access.

## Overview

This system allows theatre production teams to randomly select audience members during performances. Each audience member is assigned a unique code upon joining the application. When the production team announces or selects a specific code, the corresponding audience member's camera and microphone are activated (with their permission), allowing their live video and audio to be projected onto the main screen.

## Features (MVP)

- 🎫 Random audience code assignment
- 🎯 Real-time code matching and audience selection
- 📷 Camera/microphone activation (with user permission)
- 🖥️ Live video & audio streaming to production team
- 🌐 Works entirely on a local network (no internet required)
- 📱 Mobile-friendly interface for audience

## Prerequisites

- Node.js (v14+)
- Local Wi-Fi network
- A server device (laptop, Synology NAS, or Intel NUC)
- OBS Studio or similar software for projection (optional)

## Setup Instructions

1. Clone or download this repository

2. Install dependencies:
   ```
   npm install
   ```

3. Start the server:
   ```
   npm start
   ```

4. Connect server to your local Wi-Fi network (or create a hotspot)

5. Find your server's local IP address (e.g., 192.168.1.100)

6. Audience members connect to the Wi-Fi network and visit your server's IP address in their browser (e.g., http://192.168.1.100:3000)

7. Production team accesses the admin panel at /admin.html (e.g., http://192.168.1.100:3000/admin.html)

## How It Works

1. **Audience Connection**:
   - Audience members connect to local WiFi
   - They visit the server's IP address in their browser
   - Each receives a unique 4-character code

2. **Selection Process**:
   - Production team enters a specific code or selects randomly
   - The system identifies the matching audience member
   - Selected audience member receives a notification

3. **Stream Activation**:
   - Audience member grants camera/microphone permissions
   - WebRTC establishes a peer-to-peer connection
   - Video appears on admin panel, ready for projection

## Security and Privacy

- All media stays within the local LAN
- No internet access required
- User must explicitly consent for camera/mic activation
- Connection is closed when session ends

## Production Setup

For optimal performance in a production environment:

1. Use a dedicated Wi-Fi router (like ASUS ROG GT6 Mesh System)
2. Position access points strategically throughout the venue
3. Configure router for optimal performance (5GHz band preferred)
4. Use a wired connection for the admin/projection computer
5. Test with expected audience size before the actual performance

## Extending the MVP

Future enhancements could include:
- Multiple simultaneous streams
- Text messaging/Q&A features
- Custom audience interactions
- Advanced randomization options
- Enhanced admin controls

## Troubleshooting

- **Connection Issues**: Ensure all devices are on the same network
- **Video Quality Problems**: Adjust WebRTC constraints in code
- **Capacity Limitations**: Reduce network congestion, upgrade router
- **Permission Issues**: Ensure browser supports getUserMedia API
- **Latency Issues**: Optimize network settings, reduce distance to access points

## License

MIT License - Feel free to modify and use as needed