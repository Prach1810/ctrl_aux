// Global state
let currentUser = null; // Stores the current logged-in Spotify user
let currentSession = null; // Stores the current session object
let socket = null; // Socket.io connection
let accessToken = null; // Spotify access token
let isDJ = false; // True if the current user is the DJ of the session
let pendingRequests = []; // List of pending song requests for DJ approval
let spotifyPlayer = null; // Spotify Web Player instance
let deviceId = null; // Current device ID for playback
let isPlaying = false; // Track playback state

// DOM elements
const elements = {
    loginBtn: document.getElementById('loginBtn'), // Spotify login button
    userInfo: document.getElementById('userInfo'), // User info display (username, logout)
    username: document.getElementById('username'), // Username display
    logoutBtn: document.getElementById('logoutBtn'), // Logout button
    createSessionBtn: document.getElementById('createSessionBtn'), // Button to open create session modal
    joinSessionBtn: document.getElementById('joinSessionBtn'), // Button to open join session modal
    welcomeSection: document.getElementById('welcomeSection'), // Welcome/landing section
    sessionInterface: document.getElementById('sessionInterface'), // Main session UI
    createModal: document.getElementById('createModal'), // Modal for creating session
    joinModal: document.getElementById('joinModal'), // Modal for joining session
    sessionName: document.getElementById('sessionName'), // Input for session name
    playlistId: document.getElementById('playlistId'), // Input for playlist ID
    createConfirmBtn: document.getElementById('createConfirmBtn'), // Confirm create session
    createCancelBtn: document.getElementById('createCancelBtn'), // Cancel create session
    sessionCode: document.getElementById('sessionCode'), // Input for session code (join)
    usernameInput: document.getElementById('usernameInput'), // Input for username (join)
    joinConfirmBtn: document.getElementById('joinConfirmBtn'), // Confirm join session
    joinCancelBtn: document.getElementById('joinCancelBtn'), // Cancel join session
    sessionTitle: document.getElementById('sessionTitle'), // Session name display
    sessionCodeText: document.getElementById('sessionCodeText'), // Session code display
    participantCount: document.getElementById('participantCount'), // Number of participants
    playNextBtn: document.getElementById('playNextBtn'), // DJ: Play next song button
    currentSongSection: document.getElementById('currentSongSection'), // Current song info section
    currentSongArt: document.getElementById('currentSongArt'), // Current song album art
    currentSongName: document.getElementById('currentSongName'), // Current song name
    currentSongArtist: document.getElementById('currentSongArtist'), // Current song artist
    searchInput: document.getElementById('searchInput'), // Song search input
    searchBtn: document.getElementById('searchBtn'), // Song search button
    searchResults: document.getElementById('searchResults'), // Container for search results
    queueList: document.getElementById('queueList'), // Song queue display
    statsSection: document.getElementById('statsSection'), // Stats section (votes, users, etc.)
    totalVotes: document.getElementById('totalVotes'), // Total votes display
    songsPlayed: document.getElementById('songsPlayed'), // Songs played display
    activeUsers: document.getElementById('activeUsers'), // Active users display
    pendingRequests: document.getElementById('pendingRequests') // Container for DJ to see/manage song requests
};

// Initialize app: set up event listeners and check authentication
// This runs when the DOM is fully loaded
// Sets up all button handlers and checks if the user is already logged in
// If logged in, updates UI accordingly
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    checkAuthStatus();
});

function setupEventListeners() {
    // Authentication
    elements.loginBtn.addEventListener('click', handleSpotifyLogin);
    elements.logoutBtn.addEventListener('click', handleLogout);

    // Session management
    elements.createSessionBtn.addEventListener('click', () => showModal('createModal'));
    elements.joinSessionBtn.addEventListener('click', () => showModal('joinModal'));
    elements.createCancelBtn.addEventListener('click', () => hideModal('createModal'));
    elements.joinCancelBtn.addEventListener('click', () => hideModal('joinModal'));
    elements.createConfirmBtn.addEventListener('click', handleCreateSession);
    elements.joinConfirmBtn.addEventListener('click', handleJoinSession);

    // Session interface
    elements.playNextBtn.addEventListener('click', handlePlayNext);
    elements.searchBtn.addEventListener('click', handleSearch);
    elements.searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });
}

function checkAuthStatus() {
    const token = localStorage.getItem('spotify_access_token');
    if (token) {
      accessToken = token;
      currentUser = JSON.parse(localStorage.getItem('spotify_user') || '{}');
      updateAuthUI(true);
    }
  }

  function handleSpotifyLogin() {
    localStorage.removeItem('spotify_access_token');
    localStorage.removeItem('spotify_refresh_token');
    localStorage.removeItem('spotify_user');
    window.location.href = '/auth/spotify';
  }

function handleLogout() {
    localStorage.removeItem('spotify_access_token');
    localStorage.removeItem('spotify_user');
    accessToken = null;
    currentUser = null;
    updateAuthUI(false);
    showWelcomeSection();
}

function updateAuthUI(isLoggedIn) {
    if (isLoggedIn) {
        elements.loginBtn.classList.add('hidden');
        elements.userInfo.classList.remove('hidden');
        elements.username.textContent = currentUser.display_name || 'User';
        // Initialize Spotify Player after successful login
        setTimeout(() => {
            initializeSpotifyPlayer();
        }, 1000);
    } else {
        elements.loginBtn.classList.remove('hidden');
        elements.userInfo.classList.add('hidden');
    }
}

function showModal(modalId) {
    if (!accessToken) {
        alert('Please connect your Spotify account first!');
        return;
    }
    document.getElementById(modalId).classList.remove('hidden');
}

function hideModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}

// --- SESSION CREATION & JOIN ---
// handleCreateSession: Called when user confirms creating a session
// - Sends session name, playlist, and user info to backend
// - Sets isDJ to true for the creator
// - Shows session UI and connects to Socket.io
async function handleCreateSession() {
    const sessionName = elements.sessionName.value.trim();
    const playlistId = elements.playlistId.value.trim();

    if (!sessionName) {
        alert('Please enter a session name');
        return;
    }

    try {
        const response = await fetch('/api/session/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken,
                sessionName,
                playlistId: playlistId || null,
                username: currentUser.display_name,
                userId: currentUser.id,
                songsPlayed: 0 // Initialize songs played counter
            })
        });

        const data = await response.json();

        if (data.sessionId) {
            currentSession = data.session;
            isDJ = (currentSession.dj && currentSession.dj.userId === currentUser.id);
            hideModal('createModal');
            showSessionInterface();
            connectToSession(data.sessionId);
            updateDJUI();
        } else {
            alert('Failed to create session');
        }
    } catch (error) {
        console.error('Error creating session:', error);
        alert('Failed to create session');
    }
}

// handleJoinSession: Called when user joins a session
// - Sends username and userId to backend
// - Sets isDJ to true if user is the DJ
// - Shows session UI and connects to Socket.io
async function handleJoinSession() {
    try {
        // Add null checks
        if (!elements.sessionCode || !elements.usernameInput) {
            throw new Error('Form elements not found');
        }

        const sessionId = elements.sessionCode.value.trim();
        const username = elements.usernameInput.value.trim();

        if (!sessionId) {
            alert('Please enter a session code');
            return;
        }
        if (!username) {
            alert('Please enter your name');
            return;
        }

        // Verify session exists
        const verifyResponse = await fetch(`/api/session/${sessionId}`);
        if (!verifyResponse.ok) {
            throw new Error('Session not found');
        }

        // Join session
        const joinResponse = await fetch('/api/session/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId,
                username,
                userId: currentUser.id
            })
        });

        if (!joinResponse.ok) {
            throw new Error('Failed to join session');
        }

        const data = await joinResponse.json();
        currentSession = data.session;
        isDJ = (currentSession.dj && currentSession.dj.userId === currentUser.id);

        hideModal('joinModal');
        showSessionInterface();
        connectToSession(sessionId);
        updateDJUI();

    } catch (error) {
        console.error('Error joining session:', error);
        alert(`Error joining session: ${error.message}`);
    }
}

function initializeSpotifyPlayer() {
    if (!accessToken) {
        console.error("No access token for player initialization");
        return;
    }

    // Check if SDK is loaded
    if (!window.Spotify) {
        console.error("Spotify SDK not loaded! Retrying in 1 second...");
        setTimeout(initializeSpotifyPlayer, 1000); // Retry after 1 second
        return;
    }

    console.log("Initializing Spotify Player...");
    spotifyPlayer = new Spotify.Player({
        name: 'CTRL THE AUX Web Player',
        getOAuthToken: cb => { cb(accessToken); },
        volume: 0.5
    });

    // Add ready listener to get deviceId
    spotifyPlayer.addListener('ready', ({ device_id }) => {
        console.log('Ready with Device ID', device_id);
        deviceId = device_id;
    });

    // Add error listeners
    spotifyPlayer.addListener('initialization_error', ({ message }) => {
        console.error("Initialization Error:", message);
    });

    spotifyPlayer.addListener('authentication_error', ({ message }) => {
        console.error("Auth Error:", message);
    });

    spotifyPlayer.addListener('account_error', ({ message }) => {
        console.error("Account Error:", message);
    });

    // Connect to the player
    spotifyPlayer.connect().then(success => {
        if (success) {
            console.log("Connected to Spotify Player!");
        } else {
            console.error("Failed to connect to player");
        }
    });
}

async function playSongOnWebPlayer(songUri) {
    if (!spotifyPlayer || !deviceId) {
        alert('Web player not ready. Please wait or check your Spotify Premium subscription.');
        return false;
    }

    try {
        const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                uris: [songUri]
            })
        });

        if (response.ok) {
            console.log('Successfully started playback');
            isPlaying = true;
            return true;
        } else {
            console.error('Failed to start playback:', response.statusText);
            return false;
        }
    } catch (error) {
        console.error('Error playing song:', error);
        return false;
    }
}

function showSessionInterface() {
    elements.welcomeSection.classList.add('hidden');
    elements.sessionInterface.classList.remove('hidden');
    elements.statsSection.classList.remove('hidden');

    updateSessionUI();
}

function showWelcomeSection() {
    elements.welcomeSection.classList.remove('hidden');
    elements.sessionInterface.classList.add('hidden');
    elements.statsSection.classList.add('hidden');
}

function updateSessionUI() {
    if (!currentSession) return;

    elements.sessionTitle.textContent = currentSession.name;
    elements.sessionCodeText.textContent = currentSession.id;
    elements.participantCount.textContent = `${currentSession.participants.length} participants`;

    if (currentSession.currentSong) {
        showCurrentSong(currentSession.currentSong);
    }

    updateQueueDisplay();
    updateStats();
}

// --- SOCKET.IO CONNECTION ---
// connectToSession: Sets up real-time event listeners for the session
// - voteUpdate: Updates vote count for a song
// - queueUpdate: Updates the queue when changed
// - songPlayed: Updates current song and queue
// - pendingRequestsUpdate: Updates the DJ's pending requests list
// - If DJ, fetches initial pending requests from backend
function connectToSession(sessionId) {
    socket = io();

    socket.on('newSongRequest', (song) => {
        if (isDJ) {
            showDJPopup(song);
        }
    });

    socket.emit('joinSession', sessionId);

    socket.on('voteUpdate', (data) => {
        updateSongVotes(data.songId, data.votes);
        updateStats(); // Update stats when votes change
    });

    socket.on('queueUpdate', (data) => {
        currentSession.queue = data.queue;
        updateQueueDisplay();
        updateStats(); // Update stats when queue changes
    });

    socket.on('songPlayed', (data) => {
        currentSession.currentSong = data.currentSong;
        currentSession.queue = data.queue;
        currentSession.songsPlayed = data.songsPlayed || 0;
        showCurrentSong(data.currentSong);
        updateQueueDisplay();
        updateStats();
    });

    socket.on('pendingRequestsUpdate', (data) => {
        pendingRequests = data.pendingRequests;
        updatePendingRequestsUI();
    });

    if (isDJ) {
        fetch(`/api/session/${sessionId}/pending-requests`)
            .then(res => res.json())
            .then(data => {
                pendingRequests = data.pendingRequests || [];
                updatePendingRequestsUI();
            });
    }
}

function showCurrentSong(song) {
    elements.currentSongSection.classList.remove('hidden');
    elements.currentSongName.textContent = song.name;
    elements.currentSongArtist.textContent = song.artist;
    if (song.albumArt) {
        elements.currentSongArt.src = song.albumArt;
        elements.currentSongArt.style.display = 'block';
    } else {
        elements.currentSongArt.style.display = 'none';
    }
}

// --- SONG SEARCH & REQUEST/ADD ---
// displaySearchResults: Shows search results
// - If DJ, can add songs directly to queue
// - If user, can only request songs (not add directly)
// requestSong: Sends a song request to backend for DJ approval
// addSongToQueue: (DJ only) Adds song directly to queue
async function handleSearch() {
    const query = elements.searchInput.value.trim();
    if (!query) return;

    try {
        const response = await fetch(`/api/search?query=${encodeURIComponent(query)}&accessToken=${accessToken}`);
        const data = await response.json();

        displaySearchResults(data.tracks);
    } catch (error) {
        console.error('Error searching:', error);
    }
}

function displaySearchResults(tracks) {
    elements.searchResults.innerHTML = '';

    tracks.forEach(track => {
        const trackElement = document.createElement('div');
        trackElement.className = 'song-card rounded-lg p-4 flex items-center justify-between';
        trackElement.innerHTML = `
            <div class="flex items-center space-x-3">
                <img src="${track.albumArt || 'https://via.placeholder.com/40'}" alt="Album Art" class="w-10 h-10 rounded">
                <div>
                    <h4 class="text-white font-semibold">${track.name}</h4>
                    <p class="text-gray-300 text-sm">${track.artist}</p>
                </div>
            </div>
            <div class="flex space-x-2">
                <button class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg"
                    onclick="playSongOnWebPlayer('${track.uri}')">
                    <i class="fas fa-play"></i> Play
                </button>
                <button class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg">
                    <i class="fas fa-plus"></i> ${isDJ ? 'Add to Queue' : 'Request Song'}
                </button>
            </div>
        `;
        trackElement.querySelector('button:nth-child(2)').onclick = () => {
            if (isDJ) {
                addSongToQueue(track); // Pass the entire track object now
            } else {
                requestSong(track);
            }
        };
        elements.searchResults.appendChild(trackElement);
    });
}

async function addSongToQueue(track) {
    if (!currentSession) return;

    try {
        const response = await fetch(`/api/session/${currentSession.id}/add-song`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                song: {
                    id: track.id,
                    name: track.name,
                    artist: track.artist,
                    uri: track.uri,
                    albumArt: track.albumArt || 'https://via.placeholder.com/40',
                    votes: 0
                }
            })
        });

        const data = await response.json();
        if (data.success) {
            elements.searchInput.value = '';
            elements.searchResults.innerHTML = '';
        }
    } catch (error) {
        console.error('Error adding song:', error);
    }
}

// Users submit a song request for DJ approval
async function requestSong(track) {
    if (!currentSession) return;
    try {
        const response = await fetch(`/api/session/${currentSession.id}/request-song`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                song: {
                    id: track.id,
                    name: track.name,
                    artist: track.artist,
                    uri: track.uri,
                    albumArt: track.albumArt || 'https://via.placeholder.com/40'
                },
                requestedBy: { username: currentUser.display_name, userId: currentUser.id }
            })
        });
        const data = await response.json();
        if (data.success) {
            elements.searchInput.value = '';
            elements.searchResults.innerHTML = '<p class="text-green-400">Request sent!</p>';
        }
    } catch (error) {
        console.error('Error requesting song:', error);
    }
}

// DJ approves a song request, moving it to the queue
async function approveRequest(songId) {
    if (!currentSession) return;
    try {
        await fetch(`/api/session/${currentSession.id}/approve-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ songId, userId: currentUser.id })
        });
    } catch (error) {
        console.error('Error approving request:', error);
    }
}

// DJ denies a song request, removing it from pending
async function denyRequest(songId) {
    if (!currentSession) return;
    try {
        await fetch(`/api/session/${currentSession.id}/deny-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ songId, userId: currentUser.id })
        });
    } catch (error) {
        console.error('Error denying request:', error);
    }
}

// --- PENDING REQUESTS ---
// updatePendingRequestsUI: For DJ, displays all pending requests with Approve/Deny buttons
// - Approve: Moves song to queue
// - Deny: Removes request
// - For users, this section is hidden
function updatePendingRequestsUI() {
    if (!isDJ || !elements.pendingRequests) return;
    if (!pendingRequests.length) {
        elements.pendingRequests.innerHTML = '<p class="text-gray-400">No pending song requests.</p>';
        return;
    }
    elements.pendingRequests.innerHTML = pendingRequests.map(req => `
        <div class="song-card rounded-lg p-4 flex items-center justify-between mb-2">
            <div class="flex items-center space-x-3">
                <img src="${req.albumArt || 'https://via.placeholder.com/40'}" alt="Album Art" class="w-10 h-10 rounded">
                <div>
                    <h4 class="text-white font-semibold">${req.name}</h4>
                    <p class="text-gray-300 text-sm">${req.artist}</p>
                    <p class="text-xs text-gray-400">Requested by: ${req.requestedBy.username}</p>
                </div>
            </div>
            <div class="flex space-x-2">
                <button class="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded" onclick="approveRequest('${req.id}')">Approve</button>
                <button class="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded" onclick="denyRequest('${req.id}')">Deny</button>
            </div>
        </div>
    `).join('');
}

// --- ROLE-BASED UI ---
// updateDJUI: Shows/hides DJ controls (play next, pending requests) based on isDJ
// - Only DJ sees play next and pending requests panel
function updateDJUI() {
    if (isDJ) {
        elements.playNextBtn.classList.remove('hidden');
        if (elements.pendingRequests) elements.pendingRequests.classList.remove('hidden');
    } else {
        elements.playNextBtn.classList.add('visible');
        if (elements.pendingRequests) elements.pendingRequests.classList.add('hidden');
    }
}

// --- QUEUE, VOTING, AND STATS ---
// updateQueueDisplay: Shows the current queue, sorted by votes
// voteSong: Lets users vote up/down on songs
// updateSongVotes: Updates vote count for a song in the UI
// updateStats: Updates stats (total votes, active users, etc.)
function updateQueueDisplay() {
    if (!currentSession || !currentSession.queue.length) {
        elements.queueList.innerHTML = '<p class="text-gray-300 text-center py-8">No songs in queue. Search and add some songs to get started!</p>';
        return;
    }

    // Sort by votes (highest first)
    const sortedQueue = [...currentSession.queue].sort((a, b) => b.votes - a.votes);

    elements.queueList.innerHTML = sortedQueue.map((song, index) => `
        <div class="song-card rounded-lg p-4 flex items-center justify-between">
            <div class="flex items-center space-x-4">
                <img src="${song.albumArt || 'https://via.placeholder.com/40'}" alt="Album Art" class="w-12 h-12 rounded">
                <div class="text-center">
                    <div class="text-2xl font-bold text-white">${index + 1}</div>
                    <div class="text-sm text-gray-300">${song.votes} votes</div>
                </div>
                <div>
                    <h4 class="text-white font-semibold">${song.name}</h4>
                    <p class="text-gray-300">${song.artist}</p>
                </div>
            </div>
            <div class="flex items-center space-x-2">
                <button onclick="voteSong('${song.id}', 'up')"
                        class="vote-animation bg-green-500 hover:bg-green-600 text-white p-2 rounded-full">
                    <i class="fas fa-thumbs-up"></i>
                </button>
                <button onclick="voteSong('${song.id}', 'down')"
                        class="vote-animation bg-red-500 hover:bg-red-600 text-white p-2 rounded-full">
                    <i class="fas fa-thumbs-down"></i>
                </button>
            </div>
        </div>
    `).join('');
}

async function voteSong(songId, voteType) {
    if (!currentSession || !currentUser) return;

    try {
        const response = await fetch(`/api/session/${currentSession.id}/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                songId,
                username: currentUser.display_name || 'Anonymous',
                voteType
            })
        });

        const data = await response.json();
        if (data.success) {
            // Update will come through socket
        }
    } catch (error) {
        console.error('Error voting:', error);
    }
}

function updateSongVotes(songId, votes) {
    if (currentSession) {
        const song = currentSession.queue.find(s => s.id === songId);
        if (song) {
            song.votes = votes;
            updateQueueDisplay();
        }
    }
}

async function handlePlayNext() {
    if (!currentSession) return;

    try {
        // Sort queue by votes (highest first)
        currentSession.queue.sort((a, b) => b.votes - a.votes);
        const nextSong = currentSession.queue[0];

        if (!nextSong) {
            alert('No songs in queue');
            return;
        }

        // Try to play using Web Player first
        const success = await playSongOnWebPlayer(nextSong.uri);

        if (success) {
            // Remove song from queue and update UI
            currentSession.queue.shift();
            currentSession.currentSong = nextSong;

            // Increment songs played counter
            if (!currentSession.songsPlayed) {
                currentSession.songsPlayed = 1;
            } else {
                currentSession.songsPlayed++;
            }

            showCurrentSong(nextSong);
            updateQueueDisplay();
            updateStats();

            // Emit to other users via socket
            if (socket) {
                socket.emit('songPlayed', {
                    currentSong: nextSong,
                    queue: currentSession.queue,
                    songsPlayed: currentSession.songsPlayed
                });
            }
        } else {
            // Fallback to server-side playback
            const response = await fetch(`/api/session/${currentSession.id}/play-next`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accessToken })
            });

            const data = await response.json();
            if (!data.success) {
                alert('No songs in queue or failed to play');
            }
        }
    } catch (error) {
        console.error('Error playing next song:', error);
        alert('Failed to play next song');
    }
}

function updateStats() {
    if (!currentSession) return;

    // Calculate total votes from queue
    const totalVotes = currentSession.queue.reduce((sum, song) => sum + song.votes, 0);
    elements.totalVotes.textContent = totalVotes;

    // Update active users count
    elements.activeUsers.textContent = currentSession.participants.length;

    // Get songs played count from session or initialize it
    if (!currentSession.songsPlayed) {
        currentSession.songsPlayed = 0;
    }
    elements.songsPlayed.textContent = currentSession.songsPlayed;
}

// --- AUTH & CALLBACK HANDLING ---
// handleSpotifyCallback: Handles Spotify OAuth callback, stores tokens and user info
// - Called automatically if redirected from Spotify login
// - Updates UI and cleans up URL
function handleSpotifyCallback() {
    // Parse the URL hash for tokens and user info
    const hash = window.location.hash.substring(1); // Remove '#'
    const params = new URLSearchParams(hash.replace(/&/g, '&'));
    const accessTokenParam = params.get('accessToken');
    const refreshToken = params.get('refreshToken');
    const userBase64 = params.get('user');
    let user = null;
    if (userBase64) {
        try {
            user = JSON.parse(atob(userBase64));
        } catch (e) {
            user = null;
        }
    }
    if (accessTokenParam && user) {
        localStorage.setItem('spotify_access_token', accessTokenParam);
        localStorage.setItem('spotify_user', JSON.stringify(user));
        accessToken = accessTokenParam;
        currentUser = user;
        updateAuthUI(true);
        // Clean the URL (remove hash)
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}


function showDJPopup(song) {
    const container = document.getElementById('djToastContainer');

    const toast = document.createElement('div');
    toast.className = "flex items-center justify-between bg-[#121212] text-white p-4 rounded-lg shadow-lg space-x-4 w-[400px] animate-fadeIn";

    toast.innerHTML = `
      <div class="flex items-center space-x-4">
        <img src="${song.albumArt || 'https://via.placeholder.com/60'}" alt="Album Art" class="w-14 h-14 rounded">
        <div>
          <div class="font-semibold text-lg">Song Request:</div>
          <div class="font-bold text-white text-base">${song.name}</div>
          <div class="text-gray-400 text-sm">${song.artist}</div>
        </div>
      </div>
      <div class="flex space-x-2">
        <button class="deny-btn bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded flex items-center">
          <span class="mr-1">✕</span>Deny
        </button>
        <button class="accept-btn bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded flex items-center">
          Accept<span class="ml-1">✔</span>
        </button>
      </div>
    `;

    const acceptBtn = toast.querySelector('.accept-btn');
    const denyBtn = toast.querySelector('.deny-btn');

    acceptBtn.onclick = () => {
        // Call approveRequest which will handle adding to queue via the backend
        approveRequest(song.id);
        container.removeChild(toast);
    };

    denyBtn.onclick = () => {
        // Call denyRequest which will handle removing the request via the backend
        denyRequest(song.id);
        container.removeChild(toast);
    };

    container.appendChild(toast);

    // Auto-remove after 10 seconds if not acted upon
    setTimeout(() => {
        if (container.contains(toast)) {
            container.removeChild(toast);
        }
    }, 10000);
}

window.currentUser = currentUser;
window.playSongOnWebPlayer = playSongOnWebPlayer;

// Global state
// let currentUser = null; // Stores the current logged-in Spotify user
// let currentSession = null; // Stores the current session object
// let socket = null; // Socket.io connection
// let accessToken = null; // Spotify access token
// let isDJ = false; // True if the current user is the DJ of the session
// let pendingRequests = []; // List of pending song requests for DJ approval
// let spotifyPlayer = null; // Spotify Web Player instance
// let deviceId = null; // Current device ID for playback
// let isPlaying = false; // Track playback state

// DOM elements
// const elements = {
//     loginBtn: document.getElementById('loginBtn'), // Spotify login button
//     userInfo: document.getElementById('userInfo'), // User info display (username, logout)
//     username: document.getElementById('username'), // Username display
//     logoutBtn: document.getElementById('logoutBtn'), // Logout button
//     createSessionBtn: document.getElementById('createSessionBtn'), // Button to open create session modal
//     joinSessionBtn: document.getElementById('joinSessionBtn'), // Button to open join session modal
//     welcomeSection: document.getElementById('welcomeSection'), // Welcome/landing section
//     sessionInterface: document.getElementById('sessionInterface'), // Main session UI
//     createModal: document.getElementById('createModal'), // Modal for creating session
//     joinModal: document.getElementById('joinModal'), // Modal for joining session
//     sessionName: document.getElementById('sessionName'), // Input for session name
//     playlistId: document.getElementById('playlistId'), // Input for playlist ID
//     createConfirmBtn: document.getElementById('createConfirmBtn'), // Confirm create session
//     createCancelBtn: document.getElementById('createCancelBtn'), // Cancel create session
//     sessionCode: document.getElementById('sessionCode'), // Input for session code (join)
//     usernameInput: document.getElementById('usernameInput'), // Input for username (join)
//     joinConfirmBtn: document.getElementById('joinConfirmBtn'), // Confirm join session
//     joinCancelBtn: document.getElementById('joinCancelBtn'), // Cancel join session
//     sessionTitle: document.getElementById('sessionTitle'), // Session name display
//     sessionCodeText: document.getElementById('sessionCodeText'), // Session code display
//     participantCount: document.getElementById('participantCount'), // Number of participants
//     playNextBtn: document.getElementById('playNextBtn'), // DJ: Play next song button
//     currentSongSection: document.getElementById('currentSongSection'), // Current song info section
//     currentSongArt: document.getElementById('currentSongArt'), // Current song album art
//     currentSongName: document.getElementById('currentSongName'), // Current song name
//     currentSongArtist: document.getElementById('currentSongArtist'), // Current song artist
//     searchInput: document.getElementById('searchInput'), // Song search input
//     searchBtn: document.getElementById('searchBtn'), // Song search button
//     searchResults: document.getElementById('searchResults'), // Container for search results
//     queueList: document.getElementById('queueList'), // Song queue display
//     statsSection: document.getElementById('statsSection'), // Stats section (votes, users, etc.)
//     totalVotes: document.getElementById('totalVotes'), // Total votes display
//     songsPlayed: document.getElementById('songsPlayed'), // Songs played display
//     activeUsers: document.getElementById('activeUsers'), // Active users display
//     pendingRequests: document.getElementById('pendingRequests') // Container for DJ to see/manage song requests
// };

// // Initialize app: set up event listeners and check authentication
// // This runs when the DOM is fully loaded
// // Sets up all button handlers and checks if the user is already logged in
// // If logged in, updates UI accordingly
// document.addEventListener('DOMContentLoaded', () => {
//     setupEventListeners();
//     checkAuthStatus();
// });

// function setupEventListeners() {
//     // Authentication
//     elements.loginBtn.addEventListener('click', handleSpotifyLogin);
//     elements.logoutBtn.addEventListener('click', handleLogout);

//     // Session management
//     elements.createSessionBtn.addEventListener('click', () => showModal('createModal'));
//     elements.joinSessionBtn.addEventListener('click', () => showModal('joinModal'));
//     elements.createCancelBtn.addEventListener('click', () => hideModal('createModal'));
//     elements.joinCancelBtn.addEventListener('click', () => hideModal('joinModal'));
//     elements.createConfirmBtn.addEventListener('click', handleCreateSession);
//     elements.joinConfirmBtn.addEventListener('click', handleJoinSession);

//     // Session interface
//     elements.playNextBtn.addEventListener('click', handlePlayNext);
//     elements.searchBtn.addEventListener('click', handleSearch);
//     elements.searchInput.addEventListener('keypress', (e) => {
//         if (e.key === 'Enter') handleSearch();
//     });
// }

// function checkAuthStatus() {
//     const token = localStorage.getItem('spotify_access_token');
//     if (token) {
//       accessToken = token;
//       currentUser = JSON.parse(localStorage.getItem('spotify_user') || '{}');
//       updateAuthUI(true);
//     }
//   }

//   function handleSpotifyLogin() {
//     localStorage.removeItem('spotify_access_token');
//     localStorage.removeItem('spotify_refresh_token');
//     localStorage.removeItem('spotify_user');
//     window.location.href = '/auth/spotify';
//   }

// function handleLogout() {
//     localStorage.removeItem('spotify_access_token');
//     localStorage.removeItem('spotify_user');
//     accessToken = null;
//     currentUser = null;
//     updateAuthUI(false);
//     showWelcomeSection();
// }

// function updateAuthUI(isLoggedIn) {
//     if (isLoggedIn) {
//         elements.loginBtn.classList.add('hidden');
//         elements.userInfo.classList.remove('hidden');
//         elements.username.textContent = currentUser.display_name || 'User';
//         // Initialize Spotify Player after successful login
//         setTimeout(() => {
//             initializeSpotifyPlayer();
//         }, 1000);
//     } else {
//         elements.loginBtn.classList.remove('hidden');
//         elements.userInfo.classList.add('hidden');
//     }
// }

// function showModal(modalId) {
//     if (!accessToken) {
//         alert('Please connect your Spotify account first!');
//         return;
//     }
//     document.getElementById(modalId).classList.remove('hidden');
// }

// function hideModal(modalId) {
//     document.getElementById(modalId).classList.add('hidden');
// }

// // --- SESSION CREATION & JOIN ---
// // handleCreateSession: Called when user confirms creating a session
// // - Sends session name, playlist, and user info to backend
// // - Sets isDJ to true for the creator
// // - Shows session UI and connects to Socket.io
// async function handleCreateSession() {
//     const sessionName = elements.sessionName.value.trim();
//     const playlistId = elements.playlistId.value.trim();

//     if (!sessionName) {
//         alert('Please enter a session name');
//         return;
//     }

//     try {
//         const response = await fetch('/api/session/create', {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({
//                 accessToken,
//                 sessionName,
//                 playlistId: playlistId || null,
//                 username: currentUser.display_name,
//                 userId: currentUser.id
//             })
//         });

//         const data = await response.json();

//         if (data.sessionId) {
//             currentSession = data.session;
//             isDJ = (currentSession.dj && currentSession.dj.userId === currentUser.id);
//             hideModal('createModal');
//             showSessionInterface();
//             connectToSession(data.sessionId);
//             updateDJUI();
//         } else {
//             alert('Failed to create session');
//         }
//     } catch (error) {
//         console.error('Error creating session:', error);
//         alert('Failed to create session');
//     }
// }

// // handleJoinSession: Called when user joins a session
// // - Sends username and userId to backend
// // - Sets isDJ to true if user is the DJ
// // - Shows session UI and connects to Socket.io
// async function handleJoinSession() {
//     try {
//         // Add null checks
//         if (!elements.sessionCode || !elements.usernameInput) {
//             throw new Error('Form elements not found');
//         }

//         const sessionId = elements.sessionCode.value.trim();
//         const username = elements.usernameInput.value.trim();

//         if (!sessionId) {
//             alert('Please enter a session code');
//             return;
//         }
//         if (!username) {
//             alert('Please enter your name');
//             return;
//         }

//         // Verify session exists
//         const verifyResponse = await fetch(`/api/session/${sessionId}`);
//         if (!verifyResponse.ok) {
//             throw new Error('Session not found');
//         }

//         // Join session
//         const joinResponse = await fetch('/api/session/join', {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({
//                 sessionId,
//                 username,
//                 userId: currentUser.id
//             })
//         });

//         if (!joinResponse.ok) {
//             throw new Error('Failed to join session');
//         }

//         const data = await joinResponse.json();
//         currentSession = data.session;
//         isDJ = (currentSession.dj && currentSession.dj.userId === currentUser.id);

//         hideModal('joinModal');
//         showSessionInterface();
//         connectToSession(sessionId);
//         updateDJUI();

//     } catch (error) {
//         console.error('Error joining session:', error);
//         alert(`Error joining session: ${error.message}`);
//     }
// }

// function initializeSpotifyPlayer() {
//     if (!accessToken) {
//         console.error("No access token for player initialization");
//         return;
//     }

//     // Check if SDK is loaded
//     if (!window.Spotify) {
//         console.error("Spotify SDK not loaded! Retrying in 1 second...");
//         setTimeout(initializeSpotifyPlayer, 1000); // Retry after 1 second
//         return;
//     }

//     console.log("Initializing Spotify Player...");
//     spotifyPlayer = new Spotify.Player({
//         name: 'CTRL THE AUX Web Player',
//         getOAuthToken: cb => { cb(accessToken); },
//         volume: 0.5
//     });

//     // Add ready listener to get deviceId
//     spotifyPlayer.addListener('ready', ({ device_id }) => {
//         console.log('Ready with Device ID', device_id);
//         deviceId = device_id;
//     });

//     // Add error listeners
//     spotifyPlayer.addListener('initialization_error', ({ message }) => {
//         console.error("Initialization Error:", message);
//     });

//     spotifyPlayer.addListener('authentication_error', ({ message }) => {
//         console.error("Auth Error:", message);
//     });

//     spotifyPlayer.addListener('account_error', ({ message }) => {
//         console.error("Account Error:", message);
//     });

//     // Connect to the player
//     spotifyPlayer.connect().then(success => {
//         if (success) {
//             console.log("Connected to Spotify Player!");
//         } else {
//             console.error("Failed to connect to player");
//         }
//     });
// }

// async function playSongOnWebPlayer(songUri) {
//     if (!spotifyPlayer || !deviceId) {
//         alert('Web player not ready. Please wait or check your Spotify Premium subscription.');
//         return false;
//     }

//     try {
//         const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
//             method: 'PUT',
//             headers: {
//                 'Authorization': `Bearer ${accessToken}`,
//                 'Content-Type': 'application/json'
//             },
//             body: JSON.stringify({
//                 uris: [songUri]
//             })
//         });

//         if (response.ok) {
//             console.log('Successfully started playback');
//             isPlaying = true;
//             return true;
//         } else {
//             console.error('Failed to start playback:', response.statusText);
//             return false;
//         }
//     } catch (error) {
//         console.error('Error playing song:', error);
//         return false;
//     }
// }

// function showSessionInterface() {
//     elements.welcomeSection.classList.add('hidden');
//     elements.sessionInterface.classList.remove('hidden');
//     elements.statsSection.classList.remove('hidden');

//     updateSessionUI();
// }

// function showWelcomeSection() {
//     elements.welcomeSection.classList.remove('hidden');
//     elements.sessionInterface.classList.add('hidden');
//     elements.statsSection.classList.add('hidden');
// }

// function updateSessionUI() {
//     if (!currentSession) return;

//     elements.sessionTitle.textContent = currentSession.name;
//     elements.sessionCodeText.textContent = currentSession.id;
//     elements.participantCount.textContent = `${currentSession.participants.length} participants`;

//     if (currentSession.currentSong) {
//         showCurrentSong(currentSession.currentSong);
//     }

//     updateQueueDisplay();
//     updateStats();
// }

// // --- SOCKET.IO CONNECTION ---
// // connectToSession: Sets up real-time event listeners for the session
// // - voteUpdate: Updates vote count for a song
// // - queueUpdate: Updates the queue when changed
// // - songPlayed: Updates current song and queue
// // - pendingRequestsUpdate: Updates the DJ's pending requests list
// // - If DJ, fetches initial pending requests from backend
// function connectToSession(sessionId) {
//     socket = io();

//     socket.emit('joinSession', sessionId);

//     socket.on('voteUpdate', (data) => {
//         updateSongVotes(data.songId, data.votes);
//     });

//     socket.on('queueUpdate', (data) => {
//         currentSession.queue = data.queue;
//         updateQueueDisplay();
//     });

//     socket.on('songPlayed', (data) => {
//         currentSession.currentSong = data.currentSong;
//         currentSession.queue = data.queue;
//         showCurrentSong(data.currentSong);
//         updateQueueDisplay();
//         updateStats();
//     });

//     socket.on('pendingRequestsUpdate', (data) => {
//         pendingRequests = data.pendingRequests;
//         updatePendingRequestsUI();
//     });

//     if (isDJ) {
//         fetch(`/api/session/${sessionId}/pending-requests`)
//             .then(res => res.json())
//             .then(data => {
//                 pendingRequests = data.pendingRequests || [];
//                 updatePendingRequestsUI();
//             });
//     }
// }

// function showCurrentSong(song) {
//     elements.currentSongSection.classList.remove('hidden');
//     elements.currentSongName.textContent = song.name;
//     elements.currentSongArtist.textContent = song.artist;
//     if (song.albumArt) {
//         elements.currentSongArt.src = song.albumArt;
//         elements.currentSongArt.style.display = 'block';
//     } else {
//         elements.currentSongArt.style.display = 'none';
//     }
// }

// // --- SONG SEARCH & REQUEST/ADD ---
// // displaySearchResults: Shows search results
// // - If DJ, can add songs directly to queue
// // - If user, can only request songs (not add directly)
// // requestSong: Sends a song request to backend for DJ approval
// // addSongToQueue: (DJ only) Adds song directly to queue
// async function handleSearch() {
//     const query = elements.searchInput.value.trim();
//     if (!query) return;

//     try {
//         const response = await fetch(`/api/search?query=${encodeURIComponent(query)}&accessToken=${accessToken}`);
//         const data = await response.json();

//         displaySearchResults(data.tracks);
//     } catch (error) {
//         console.error('Error searching:', error);
//     }
// }

// function displaySearchResults(tracks) {
//     elements.searchResults.innerHTML = '';

//     tracks.forEach(track => {
//         const trackElement = document.createElement('div');
//         trackElement.className = 'song-card rounded-lg p-4 flex items-center justify-between';
//         trackElement.innerHTML = `
//             <div class="flex items-center space-x-3">
//                 <img src="${track.albumArt || 'https://via.placeholder.com/40'}" alt="Album Art" class="w-10 h-10 rounded">
//                 <div>
//                     <h4 class="text-white font-semibold">${track.name}</h4>
//                     <p class="text-gray-300 text-sm">${track.artist}</p>
//                 </div>
//             </div>
//             <div class="flex space-x-2">
//                 <button class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg"
//                     onclick="playSongOnWebPlayer('${track.uri}')">
//                     <i class="fas fa-play"></i> Play
//                 </button>
//                 <button class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg">
//                     <i class="fas fa-plus"></i> ${isDJ ? 'Add to Queue' : 'Request Song'}
//                 </button>
//             </div>
//         `;
//         trackElement.querySelector('button:nth-child(2)').onclick = () => {
//             if (isDJ) {
//                 addSongToQueue(track); // Pass the entire track object now
//             } else {
//                 requestSong(track);
//             }
//         };
//         elements.searchResults.appendChild(trackElement);
//     });
// }

// async function addSongToQueue(track) {
//     if (!currentSession) return;

//     try {
//         const response = await fetch(`/api/session/${currentSession.id}/add-song`, {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({
//                 song: {
//                     id: track.id,
//                     name: track.name,
//                     artist: track.artist,
//                     uri: track.uri,
//                     albumArt: track.albumArt || 'https://via.placeholder.com/40',
//                     votes: 0
//                 }
//             })
//         });

//         const data = await response.json();
//         if (data.success) {
//             elements.searchInput.value = '';
//             elements.searchResults.innerHTML = '';
//         }
//     } catch (error) {
//         console.error('Error adding song:', error);
//     }
// }

// // Users submit a song request for DJ approval
// async function requestSong(track) {
//     if (!currentSession) return;
//     try {
//         const response = await fetch(`/api/session/${currentSession.id}/request-song`, {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({
//                 song: {
//                     id: track.id,
//                     name: track.name,
//                     artist: track.artist,
//                     uri: track.uri,
//                     albumArt: track.albumArt || 'https://via.placeholder.com/40'
//                 },
//                 requestedBy: { username: currentUser.display_name, userId: currentUser.id }
//             })
//         });
//         const data = await response.json();
//         if (data.success) {
//             elements.searchInput.value = '';
//             elements.searchResults.innerHTML = '<p class="text-green-400">Request sent!</p>';
//         }
//     } catch (error) {
//         console.error('Error requesting song:', error);
//     }
// }

// // DJ approves a song request, moving it to the queue
// async function approveRequest(songId) {
//     if (!currentSession) return;
//     try {
//         await fetch(`/api/session/${currentSession.id}/approve-request`, {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({ songId, userId: currentUser.id })
//         });
//     } catch (error) {
//         console.error('Error approving request:', error);
//     }
// }

// // DJ denies a song request, removing it from pending
// async function denyRequest(songId) {
//     if (!currentSession) return;
//     try {
//         await fetch(`/api/session/${currentSession.id}/deny-request`, {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({ songId, userId: currentUser.id })
//         });
//     } catch (error) {
//         console.error('Error denying request:', error);
//     }
// }

// // --- PENDING REQUESTS ---
// // updatePendingRequestsUI: For DJ, displays all pending requests with Approve/Deny buttons
// // - Approve: Moves song to queue
// // - Deny: Removes request
// // - For users, this section is hidden
// function updatePendingRequestsUI() {
//     if (!isDJ || !elements.pendingRequests) return;
//     if (!pendingRequests.length) {
//         elements.pendingRequests.innerHTML = '<p class="text-gray-400">No pending song requests.</p>';
//         return;
//     }
//     elements.pendingRequests.innerHTML = pendingRequests.map(req => `
//         <div class="song-card rounded-lg p-4 flex items-center justify-between mb-2">
//             <div class="flex items-center space-x-3">
//                 <img src="${req.albumArt || 'https://via.placeholder.com/40'}" alt="Album Art" class="w-10 h-10 rounded">
//                 <div>
//                     <h4 class="text-white font-semibold">${req.name}</h4>
//                     <p class="text-gray-300 text-sm">${req.artist}</p>
//                     <p class="text-xs text-gray-400">Requested by: ${req.requestedBy.username}</p>
//                 </div>
//             </div>
//             <div class="flex space-x-2">
//                 <button class="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded" onclick="approveRequest('${req.id}')">Approve</button>
//                 <button class="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded" onclick="denyRequest('${req.id}')">Deny</button>
//             </div>
//         </div>
//     `).join('');
// }

// // --- ROLE-BASED UI ---
// // updateDJUI: Shows/hides DJ controls (play next, pending requests) based on isDJ
// // - Only DJ sees play next and pending requests panel
// function updateDJUI() {
//     if (isDJ) {
//         elements.playNextBtn.classList.remove('hidden');
//         if (elements.pendingRequests) elements.pendingRequests.classList.remove('hidden');
//     } else {
//         elements.playNextBtn.classList.add('visible');
//         if (elements.pendingRequests) elements.pendingRequests.classList.add('hidden');
//     }
// }

// // --- QUEUE, VOTING, AND STATS ---
// // updateQueueDisplay: Shows the current queue, sorted by votes
// // voteSong: Lets users vote up/down on songs
// // updateSongVotes: Updates vote count for a song in the UI
// // updateStats: Updates stats (total votes, active users, etc.)
// function updateQueueDisplay() {
//     if (!currentSession || !currentSession.queue.length) {
//         elements.queueList.innerHTML = '<p class="text-gray-300 text-center py-8">No songs in queue. Search and add some songs to get started!</p>';
//         return;
//     }

//     // Sort by votes (highest first)
//     const sortedQueue = [...currentSession.queue].sort((a, b) => b.votes - a.votes);

//     elements.queueList.innerHTML = sortedQueue.map((song, index) => `
//         <div class="song-card rounded-lg p-4 flex items-center justify-between">
//             <div class="flex items-center space-x-4">
//                 <img src="${song.albumArt || 'https://via.placeholder.com/40'}" alt="Album Art" class="w-12 h-12 rounded">
//                 <div class="text-center">
//                     <div class="text-2xl font-bold text-white">${index + 1}</div>
//                     <div class="text-sm text-gray-300">${song.votes} votes</div>
//                 </div>
//                 <div>
//                     <h4 class="text-white font-semibold">${song.name}</h4>
//                     <p class="text-gray-300">${song.artist}</p>
//                 </div>
//             </div>
//             <div class="flex items-center space-x-2">
//                 <button onclick="voteSong('${song.id}', 'up')"
//                         class="vote-animation bg-green-500 hover:bg-green-600 text-white p-2 rounded-full">
//                     <i class="fas fa-thumbs-up"></i>
//                 </button>
//                 <button onclick="voteSong('${song.id}', 'down')"
//                         class="vote-animation bg-red-500 hover:bg-red-600 text-white p-2 rounded-full">
//                     <i class="fas fa-thumbs-down"></i>
//                 </button>
//             </div>
//         </div>
//     `).join('');
// }

// async function voteSong(songId, voteType) {
//     if (!currentSession || !currentUser) return;

//     try {
//         const response = await fetch(`/api/session/${currentSession.id}/vote`, {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({
//                 songId,
//                 username: currentUser.display_name || 'Anonymous',
//                 voteType
//             })
//         });

//         const data = await response.json();
//         if (data.success) {
//             // Update will come through socket
//         }
//     } catch (error) {
//         console.error('Error voting:', error);
//     }
// }

// function updateSongVotes(songId, votes) {
//     if (currentSession) {
//         const song = currentSession.queue.find(s => s.id === songId);
//         if (song) {
//             song.votes = votes;
//             updateQueueDisplay();
//         }
//     }
// }

// async function handlePlayNext() {
//     if (!currentSession) return;

//     try {
//         // Sort queue by votes (highest first)
//         currentSession.queue.sort((a, b) => b.votes - a.votes);
//         const nextSong = currentSession.queue[0];

//         if (!nextSong) {
//             alert('No songs in queue');
//             return;
//         }

//         // Try to play using Web Player first
//         const success = await playSongOnWebPlayer(nextSong.uri);

//         if (success) {
//             // Remove song from queue and update UI
//             currentSession.queue.shift();
//             currentSession.currentSong = nextSong;
//             showCurrentSong(nextSong);
//             updateQueueDisplay();
//             updateStats();

//             // Emit to other users via socket
//             if (socket) {
//                 socket.emit('songPlayed', {
//                     currentSong: nextSong,
//                     queue: currentSession.queue
//                 });
//             }
//         } else {
//             // Fallback to server-side playback
//             const response = await fetch(`/api/session/${currentSession.id}/play-next`, {
//                 method: 'POST',
//                 headers: { 'Content-Type': 'application/json' },
//                 body: JSON.stringify({ accessToken })
//             });

//             const data = await response.json();
//             if (!data.success) {
//                 alert('No songs in queue or failed to play');
//             }
//         }
//     } catch (error) {
//         console.error('Error playing next song:', error);
//         alert('Failed to play next song');
//     }
// }

// function updateStats() {
//     if (!currentSession) return;

//     const totalVotes = currentSession.queue.reduce((sum, song) => sum + song.votes, 0);
//     elements.totalVotes.textContent = totalVotes;
//     elements.activeUsers.textContent = currentSession.participants.length;

//     // Songs played would need to be tracked separately
//     elements.songsPlayed.textContent = '0';
// }

// // --- AUTH & CALLBACK HANDLING ---
// // handleSpotifyCallback: Handles Spotify OAuth callback, stores tokens and user info
// // - Called automatically if redirected from Spotify login
// // - Updates UI and cleans up URL
// function handleSpotifyCallback() {
//     // Parse the URL hash for tokens and user info
//     const hash = window.location.hash.substring(1); // Remove '#'
//     const params = new URLSearchParams(hash.replace(/&/g, '&'));
//     const accessTokenParam = params.get('accessToken');
//     const refreshToken = params.get('refreshToken');
//     const userBase64 = params.get('user');
//     let user = null;
//     if (userBase64) {
//         try {
//             user = JSON.parse(atob(userBase64));
//         } catch (e) {
//             user = null;
//         }
//     }
//     if (accessTokenParam && user) {
//         localStorage.setItem('spotify_access_token', accessTokenParam);
//         localStorage.setItem('spotify_user', JSON.stringify(user));
//         accessToken = accessTokenParam;
//         currentUser = user;
//         updateAuthUI(true);
//         // Clean the URL (remove hash)
//         window.history.replaceState({}, document.title, window.location.pathname);
//     }
// }
// window.playSongOnWebPlayer = playSongOnWebPlayer;