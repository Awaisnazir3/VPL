
function copyToClipboard(text) {
  if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(`Copied ${text} to clipboard!`, 'success');
    }).catch(() => {
      showToast(`Number: ${text}`, 'info');
    });
  } else {
    showToast(`Number: ${text}`, 'info');
  }
}

let currentUserDidsCache = [];

async function fetchSubscriberIncomingDids() {
  if (!authToken || !currentUser) return;
  const container = document.getElementById('subscriberIncomingDidsContainer');
  const cardTotalDids = document.getElementById('cardTotalDids');
  const cardTotalSipForwarded = document.getElementById('cardTotalSipForwarded');
  const cardTotalPstnForwarded = document.getElementById('cardTotalPstnForwarded');

  try {
    const res = await fetch('/api/dids/my', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const dids = data.dids || [];
    currentUserDidsCache = dids;

    const myExt = String(currentUser.order_id || '2001');

    // STRICT FILTER: Only numbers delivered to WebRTC softphone are displayed here
    const webrtcDids = dids.filter(d => d.forward_type === 'SIP_URI' && (String(d.forward_destination) === myExt || !d.forward_destination || /^[0-9]{4,6}$/.test(String(d.forward_destination))));
    const pstnDids = dids.filter(d => d.forward_type === 'PSTN');

    if (cardTotalDids) cardTotalDids.textContent = dids.length;
    if (cardTotalSipForwarded) cardTotalSipForwarded.textContent = webrtcDids.length;
    if (cardTotalPstnForwarded) cardTotalPstnForwarded.textContent = pstnDids.length;

    if (!container) return;

    if (webrtcDids.length === 0) {
      container.innerHTML = `
        <div class="p-6 text-center bg-slate-50 rounded border border-dashed border-slate-300">
          <i class="fa-solid fa-headset text-2xl text-slate-400 mb-2"></i>
          <p class="font-bold text-slate-700 text-sm">No Inbound WebRTC Lines Active</p>
          <p class="text-slate-500 text-xs mt-1">Only phone numbers delivered to your WebRTC softphone appear here. (PSTN forwarded numbers can be managed in DID Forwarding).</p>
          <button type="button" onclick="switchTab('marketplace')" class="mt-3 px-4 py-1.5 rounded bg-[#28b67a] hover:bg-[#229c67] text-white font-bold text-xs inline-flex items-center gap-1.5 shadow">
            <i class="fa-solid fa-cart-shopping"></i> Browse Number Marketplace
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = webrtcDids.map(d => {
      const vmText = d.voicemail_enabled 
        ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1"><i class="fa-solid fa-voicemail"></i> Voicemail: Active (${d.voicemail_timeout || 20}s)</span>`
        : `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">Voicemail Off</span>`;

      return `
        <div id="webrtc-did-${d.did_number.replace(/[^0-9]/g, '')}" class="p-3.5 rounded bg-slate-50 border border-slate-200 hover:border-[#3b5a69] transition-all">
          <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div class="flex items-center space-x-3">
              <div class="w-9 h-9 rounded bg-[#3b5a69] text-[#8ae088] flex items-center justify-center text-sm shrink-0 shadow-sm">
                <i class="fa-solid fa-phone-volume"></i>
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-mono font-black text-base text-slate-900 tracking-tight">${d.did_number}</span>
                  <button type="button" onclick="copyToClipboard('${d.did_number}')" class="text-slate-400 hover:text-slate-700 text-xs transition-colors" title="Copy Number">
                    <i class="fa-regular fa-copy"></i>
                  </button>
                </div>
                <div class="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                  <i class="fa-solid fa-earth-americas text-slate-400"></i>
                  <span>${d.country || 'International Number'}</span>
                </div>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-1">
                <i class="fa-solid fa-headset"></i> WebRTC Line (UID ${d.forward_destination || myExt})
              </span>
              ${vmText}
              <button type="button" onclick="switchTab('routes')" class="px-2.5 py-1 rounded bg-white hover:bg-slate-100 text-[#366877] font-bold text-[11px] border border-slate-300 shadow-sm flex items-center gap-1 transition-colors">
                <i class="fa-solid fa-gear text-slate-400"></i> Settings
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.warn('Error fetching subscriber incoming DIDs:', err);
  }
}

function handleLogoClick(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (!currentUser) return;
  const isAdmin = Boolean(currentUser.is_admin === 1 || currentUser.is_admin === true || currentUser.role === 'admin');
  if (isAdmin) {
    switchTab('admin');
    switchAdminSubtab('users');
  } else {
    switchTab('dialer');
  }
}

/**
 * SipMyNumber - WebRTC Cloud Softphone Client
 * Powered by JsSIP & Asterisk 20 Media Engine
 */

// Enable JsSIP verbose debug logs in browser console
if (window.JsSIP) {
  JsSIP.debug.enable('JsSIP:*');
}

// Global Application & Auth State (backward compatible with vpl_ prefixes)
let authToken = localStorage.getItem('callme_token') || localStorage.getItem('vpl_token') || null;
let currentUser = JSON.parse(localStorage.getItem('callme_user') || localStorage.getItem('vpl_user') || 'null');
let selectedWsMode = localStorage.getItem('callme_ws_mode') || localStorage.getItem('vpl_ws_mode') || 'proxy';
let currentAuthTab = 'login'; // 'login' or 'register'

// Global WebRTC State (exposed on window for lifecycle control)
window.ua = null;
window.currentSession = null;
let isMuted = false;
let callStartTime = null;
let callTimerInterval = null;
let pendingIncomingSession = null;
let activeSocketUrl = '';

// Audio Context for Keypad DTMF audio feedback
let audioCtx = null;
const DTMF_FREQS = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477]
};

// ============================================================================
// Initialization & Protected Route Guard
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Initializing SipMyNumber Softphone Client...');
  
  // Setup WS select dropdown
  const wsSelect = document.getElementById('wsUrlSelect');
  if (wsSelect) wsSelect.value = selectedWsMode;

  // Apply Auth State Guard
  if (authToken && currentUser) {
    applyAuthState(true);
    await verifySession();
    fetchRatesCache();
    initWebRTC();

    // Handle direct navigation to /admin or #admin
    if (window.location.pathname === '/admin' || window.location.hash === '#admin') {
      if (currentUser && (currentUser.is_admin || currentUser.role === 'admin')) {
        switchTab('admin');
      }
    }
  } else {
    applyAuthState(false);
  }

  // Keyboard listener for dialpad
  const dialInput = document.getElementById('dialInput');
  if (dialInput) {
    dialInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        initiateCall();
      }
    });
  }

  // Close profile dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('profileDropdownMenu');
    const btn = document.getElementById('profileDropdownBtn');
    if (dropdown && !dropdown.classList.contains('hidden')) {
      if (!dropdown.contains(e.target) && !btn?.contains(e.target)) {
        dropdown.classList.add('hidden');
      }
    }
  });

  // Register clean WebRTC teardown on browser close / reload
  window.addEventListener('beforeunload', () => {
    disconnectWebRTC();
  });
  window.addEventListener('pagehide', () => {
    disconnectWebRTC();
  });
});

/**
 * Toggle SipMyNumber Profile Dropdown
 */
function toggleProfileMenu(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('profileDropdownMenu');
  if (dropdown) {
    dropdown.classList.toggle('hidden');
  }
}

/**
 * Authentication State Guard (SipMyNumber style)
 * When unauthenticated: STRICTLY HIDE dashboard, dialer, marketplace, status.
 * Render ONLY the clean Sign In / Sign Up screen.
 */
function applyAuthState(isAuthenticated) {
  const authView = document.getElementById('authView');
  const dashboardView = document.getElementById('dashboardView');
  const navbarUserBar = document.getElementById('navbarUserBar');
  const navbarGuestBar = document.getElementById('navbarGuestBar');

  if (isAuthenticated && currentUser) {
    // Authenticated View
    authView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    navbarUserBar.classList.remove('hidden');
    navbarGuestBar.classList.add('hidden');

    const formattedBal = `$${parseFloat(currentUser.balance || 0).toFixed(2)}`;
    const ext = currentUser.order_id || '--';
    const name = currentUser.name || 'User';
    const email = currentUser.email || 'user@example.com';
    const initial = name.charAt(0).toUpperCase();
    const isAdmin = Boolean(currentUser && (currentUser.is_admin === 1 || currentUser.is_admin === true || currentUser.role === 'admin'));

    // Top Header info
    const userNameText = document.getElementById('userNameText');
    const userAvatar = document.getElementById('userAvatar');
    const userRoleBadge = document.getElementById('userRoleBadge');
    const headerSearch = document.getElementById('headerSearchContainer');

    if (userNameText) userNameText.textContent = name;
    if (userAvatar) userAvatar.textContent = initial;
    if (userRoleBadge) {
      userRoleBadge.textContent = isAdmin ? 'ADMIN' : 'USER';
      userRoleBadge.className = isAdmin ? 'px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-purple-700 text-purple-200' : 'px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-slate-700 text-slate-300';
    }
    if (headerSearch) headerSearch.classList.remove('hidden');
    const headerInput = document.getElementById('globalHeaderSearch');
    if (headerInput) {
      headerInput.placeholder = isAdmin 
        ? "?? Search Customer ID, DID (+1...), Name, UID..." 
        : "?? Search my registered numbers (+49, Japan)...";
    }

    // Left Sidebar User Profile Card
    const sidebarUserAvatar = document.getElementById('sidebarUserAvatar');
    const sidebarUserName = document.getElementById('sidebarUserName');
    const sidebarRolePill = document.getElementById('sidebarRolePill');
    const sidebarCustomerInfo = document.getElementById('sidebarCustomerInfo');
    const sidebarAdminInfo = document.getElementById('sidebarAdminInfo');
    const customerSidebarNav = document.getElementById('customerSidebarNav');
    const adminSidebarNav = document.getElementById('adminSidebarNav');

    if (sidebarUserAvatar) sidebarUserAvatar.textContent = initial;
    if (sidebarUserName) sidebarUserName.textContent = name;

    if (isAdmin) {
      if (sidebarRolePill) {
        sidebarRolePill.textContent = 'ADMINISTRATOR';
        sidebarRolePill.className = 'inline-block mt-0.5 px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-purple-500/20 text-purple-300 border border-purple-500/30';
      }
      if (sidebarCustomerInfo) sidebarCustomerInfo.classList.add('hidden');
      if (sidebarAdminInfo) sidebarAdminInfo.classList.remove('hidden');
      if (customerSidebarNav) customerSidebarNav.classList.add('hidden');
      if (adminSidebarNav) adminSidebarNav.classList.remove('hidden');

      // Admin auto-lands on Admin Console
      checkAdminPendingRequests();
      if (currentTab !== 'admin') {
        switchTab('admin');
      }
    } else {
      if (sidebarRolePill) {
        sidebarRolePill.textContent = 'CUSTOMER ACCOUNT';
        sidebarRolePill.className = 'inline-block mt-0.5 px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
      }
      if (sidebarCustomerInfo) sidebarCustomerInfo.classList.remove('hidden');
      if (sidebarAdminInfo) sidebarAdminInfo.classList.add('hidden');
      if (customerSidebarNav) customerSidebarNav.classList.remove('hidden');
      if (adminSidebarNav) adminSidebarNav.classList.add('hidden');

      const sidebarExt = document.getElementById('sidebarExtDisplay');
      const sidebarBal = document.getElementById('sidebarBalDisplay');
      if (sidebarExt) sidebarExt.textContent = `UID ${ext}`;
      if (sidebarBal) sidebarBal.textContent = formattedBal;

      if (currentTab === 'admin') {
        switchTab('dialer');
      }
    }

    // Active Subscriber Profile Card on Dashboard
    const cardUserName = document.getElementById('cardUserName');
    const cardUserEmail = document.getElementById('cardUserEmail');
    const cardUserBalance = document.getElementById('cardUserBalance');
    const cardUserAvatar = document.getElementById('cardUserAvatar');
    const cardUserExtBadge = document.getElementById('cardUserExtBadge');
    const cardUserPhone = document.getElementById('cardUserPhone');
    const cardUserAddress = document.getElementById('cardUserAddress');
    const cardUserRegDate = document.getElementById('cardUserRegDate');

    if (cardUserName) cardUserName.textContent = name;
    if (cardUserEmail) cardUserEmail.innerHTML = `<i class="fa-regular fa-envelope text-slate-400 mr-1"></i> ${email}`;
    if (cardUserBalance) cardUserBalance.textContent = formattedBal;
    if (cardUserAvatar) cardUserAvatar.textContent = initial;
    if (cardUserExtBadge) cardUserExtBadge.textContent = `User ID (UID): ${ext}`;
    if (cardUserPhone) cardUserPhone.textContent = currentUser.phone || 'Not Provided';
    if (cardUserAddress) cardUserAddress.textContent = currentUser.address || 'Not Provided';
    if (cardUserRegDate) {
      const reg = currentUser.created_at ? new Date(currentUser.created_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '--';
      cardUserRegDate.textContent = reg;
    }

    if (!isAdmin) {
      fetchSubscriberIncomingDids();
    }

    // Zero balance alert
    const balNum = parseFloat(currentUser.balance || 0);
    const isExhausted = balNum <= 0;
    const zeroBalanceAlert = document.getElementById('zeroBalanceAlert');
    if (zeroBalanceAlert) {
      if (isExhausted) zeroBalanceAlert.classList.remove('hidden');
      else zeroBalanceAlert.classList.add('hidden');
    }
  } else {
    // Unauthenticated View
    authView.classList.remove('hidden');
    dashboardView.classList.add('hidden');
    navbarUserBar.classList.add('hidden');
    navbarGuestBar.classList.remove('hidden');

    const dropdown = document.getElementById('profileDropdownMenu');
    if (dropdown) dropdown.classList.add('hidden');

    updateWebRTCStatus('offline', 'Offline');
  }
}

async function verifySession() {
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      currentUser = { ...currentUser, ...data.user };
      localStorage.setItem('callme_user', JSON.stringify(currentUser));
      localStorage.setItem('vpl_user', JSON.stringify(currentUser));
      applyAuthState(true);
    } else {
      handleLogout();
    }
  } catch (err) {
    console.warn('Session verification check failed:', err);
  }
}

// ============================================================================
// Auth Form & Mode Toggle
// ============================================================================
function setAuthMode(mode) {
  currentAuthTab = mode;
  const tabLogin = document.getElementById('authTabLogin');
  const tabRegister = document.getElementById('authTabRegister');
  const title = document.getElementById('authCardTitle');
  const subtitle = document.getElementById('authCardSubtitle');
  const fieldFullName = document.getElementById('authFieldFullName');
  const passwordHint = document.getElementById('passwordHint');
  const submitLabel = document.getElementById('authSubmitLabel');
  const submitIcon = document.getElementById('authSubmitIcon');
  const alertError = document.getElementById('authAlertError');

  alertError.classList.add('hidden');

  if (mode === 'register') {
    tabRegister.className = 'py-2.5 rounded-xl text-xs font-semibold transition-all bg-sky-600 text-white shadow-md';
    tabLogin.className = 'py-2.5 rounded-xl text-xs font-medium text-slate-400 hover:text-white transition-all';
    title.innerHTML = 'Create Account on Sip<span class="text-sky-400">MyNumber</span>';
    subtitle.textContent = 'Auto-generates sequential UID & provisions Asterisk WebRTC';
    fieldFullName.classList.remove('hidden');
    passwordHint.classList.remove('hidden');
    submitLabel.textContent = 'Create Account & Auto-Provision';
    submitIcon.className = 'fa-solid fa-user-plus';
  } else {
    tabLogin.className = 'py-2.5 rounded-xl text-xs font-semibold transition-all bg-sky-600 text-white shadow-md';
    tabRegister.className = 'py-2.5 rounded-xl text-xs font-medium text-slate-400 hover:text-white transition-all';
    title.innerHTML = 'Sign In to Sip<span class="text-sky-400">MyNumber</span>';
    subtitle.textContent = 'High-definition WebRTC softphone & cloud telephony';
    fieldFullName.classList.add('hidden');
    passwordHint.classList.add('hidden');
    submitLabel.textContent = 'Sign In';
    submitIcon.className = 'fa-solid fa-arrow-right-to-bracket';
  }
}

async function handleAuthSubmit(event) {
  if (event && event.preventDefault) event.preventDefault();
  const alertError = document.getElementById('authAlertError');
  const alertText = document.getElementById('authAlertText');
  const submitBtn = document.getElementById('authSubmitButton');

  alertError.classList.add('hidden');
  submitBtn.disabled = true;

  const email = document.getElementById('inputEmail').value.trim();
  const password = document.getElementById('inputPassword').value.trim();
  const name = document.getElementById('inputFullName') ? document.getElementById('inputFullName').value.trim() : '';

  const endpoint = currentAuthTab === 'register' ? '/api/auth/register' : '/api/auth/login';
  const payload = currentAuthTab === 'register' ? { name, email, password } : { email, password };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Authentication failed');
    }

    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('callme_token', authToken);
    localStorage.setItem('callme_user', JSON.stringify(currentUser));
    localStorage.setItem('vpl_token', authToken);
    localStorage.setItem('vpl_user', JSON.stringify(currentUser));

    applyAuthState(true);
    showToast(currentAuthTab === 'register' ? `Account UID ${currentUser.order_id} created & provisioned!` : `Welcome! Connected as UID ${currentUser.order_id}`, 'success');

    // Automatically initialize and connect WebRTC softphone
    initWebRTC();

    // Reload active tab data
    if (currentTab === 'marketplace') fetchAvailableDids();
    if (currentTab === 'routes') fetchMyDids();
    if (currentTab === 'cdrs') fetchCdrs();
  } catch (err) {
    alertText.textContent = err.message;
    alertError.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
  }
}

/**
 * Full Clean Logout & Teardown
 */
function handleLogout() {
  console.log('[Auth] Logging out, executing clean WebRTC disconnect...');
  disconnectWebRTC(() => {
    console.log('[Auth] WebRTC disconnect routine finished');
  });

  authToken = null;
  currentUser = null;
  localStorage.removeItem('callme_token');
  localStorage.removeItem('callme_user');
  localStorage.removeItem('vpl_token');
  localStorage.removeItem('vpl_user');

  applyAuthState(false);
  showToast('Logged out of SipMyNumber', 'info');
}

// ============================================================================
// Real-Time WebRTC Lifecycle: Disconnect Routine
// ============================================================================
function disconnectWebRTC(callback) {
  console.log('[JsSIP] disconnectWebRTC() invoked');

  if (window.ua) {
    const currentUa = window.ua;
    window.ua = null;

    // 1. Terminate active audio session if present
    if (window.currentSession) {
      try {
        console.log('[JsSIP] Terminating active audio call session...');
        window.currentSession.terminate();
      } catch (e) {}
      window.currentSession = null;
    }

    // 2. Explicitly send SIP UNREGISTER (Expires: 0) to Asterisk
    try {
      if (currentUa.isRegistered()) {
        console.log('[JsSIP] Sending SIP UNREGISTER (Expires: 0) to Asterisk...');
        currentUa.unregister({ all: true });

        // Wait up to 600ms for Asterisk confirmation or timeout, then stop UA
        const stopTimer = setTimeout(() => {
          try { currentUa.stop(); } catch (e) {}
          if (callback) callback();
        }, 600);

        currentUa.once('unregistered', () => {
          clearTimeout(stopTimer);
          console.log('[JsSIP] Asterisk confirmed UNREGISTER. Stopping UA...');
          try { currentUa.stop(); } catch (e) {}
          if (callback) callback();
        });

        updateWebRTCStatus('offline', 'Disconnected');
        return;
      }
    } catch (e) {
      console.warn('[JsSIP] Unregister error:', e);
    }

    try {
      currentUa.stop();
    } catch (e) {}
  }

  updateWebRTCStatus('offline', 'Disconnected');
  if (callback) callback();
}

// ============================================================================
// WebRTC Softphone: Connection & Call Handling
// ============================================================================
function getResolvedWsUrl(mode) {
  const isHttps = window.location.protocol === 'https:';
  const host = window.location.host;

  if (mode === 'direct_wss') {
    return 'wss://192.168.88.47:8089/ws';
  } else if (mode === 'direct_ws') {
    return 'ws://192.168.88.47:8088/ws';
  } else {
    // Default: 'proxy' through portal Nginx on same origin
    const wsProto = isHttps ? 'wss:' : 'ws:';
    if (window.location.port === '3000') {
      return isHttps ? 'wss://192.168.88.47:8089/ws' : 'ws://192.168.88.47:8088/ws';
    }
    return `${wsProto}//${host}/ws`;
  }
}

function changeWsEndpoint() {
  const select = document.getElementById('wsUrlSelect');
  selectedWsMode = select.value;
  localStorage.setItem('callme_ws_mode', selectedWsMode);
  localStorage.setItem('vpl_ws_mode', selectedWsMode);

  showToast(`Switched gateway to: ${select.options[select.selectedIndex].text}`, 'info');
  reconnectWebRTC();
}

function updateWebRTCStatus(status, text) {
  const dot = document.getElementById('webrtcDot');
  const statusText = document.getElementById('webrtcStatusText');
  const dialerDot = document.getElementById('dialerIndicatorDot');
  const dialerText = document.getElementById('dialerIndicatorText');
  const userOnlineDot = document.getElementById('userOnlineDot');
  const cardLineBadge = document.getElementById('cardLineBadge');

  if (statusText) statusText.textContent = text;
  if (dialerText) dialerText.textContent = text;

  if (dot) dot.className = 'w-2.5 h-2.5 rounded-full';
  if (dialerDot) dialerDot.className = 'w-3 h-3 rounded-full';

  if (status === 'online') {
    if (dot) dot.classList.add('bg-emerald-400', 'ring-2', 'ring-emerald-400/50');
    if (dialerDot) dialerDot.classList.add('bg-emerald-400');
    if (statusText) statusText.className = 'text-emerald-400 font-semibold';
    if (userOnlineDot) userOnlineDot.className = 'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-900';
    if (cardLineBadge) {
      cardLineBadge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1';
      cardLineBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Line Ready';
    }
  } else if (status === 'connecting') {
    if (dot) dot.classList.add('bg-amber-400', 'animate-ping');
    if (dialerDot) dialerDot.classList.add('bg-amber-400');
    if (statusText) statusText.className = 'text-amber-400 font-medium';
    if (userOnlineDot) userOnlineDot.className = 'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-slate-900 animate-ping';
    if (cardLineBadge) {
      cardLineBadge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1';
      cardLineBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span> Connecting';
    }
  } else if (status === 'in-call') {
    if (dot) dot.classList.add('bg-indigo-400', 'animate-pulse');
    if (dialerDot) dialerDot.classList.add('bg-indigo-400');
    if (statusText) statusText.className = 'text-indigo-400 font-medium';
    if (userOnlineDot) userOnlineDot.className = 'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-indigo-400 ring-2 ring-slate-900 animate-pulse';
    if (cardLineBadge) {
      cardLineBadge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center gap-1';
      cardLineBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span> In Call';
    }
  } else if (status === 'error') {
    if (dot) dot.classList.add('bg-rose-500');
    if (dialerDot) dialerDot.classList.add('bg-rose-500');
    if (statusText) statusText.className = 'text-rose-400 font-medium';
    if (userOnlineDot) userOnlineDot.className = 'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-slate-900';
    if (cardLineBadge) {
      cardLineBadge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center gap-1';
      cardLineBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span> Error';
    }
  } else {
    if (dot) dot.classList.add('bg-slate-500');
    if (dialerDot) dialerDot.classList.add('bg-slate-500');
    if (statusText) statusText.className = 'text-slate-400 font-medium';
    if (userOnlineDot) userOnlineDot.className = 'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-slate-500 ring-2 ring-slate-900';
    if (cardLineBadge) {
      cardLineBadge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20 flex items-center gap-1';
      cardLineBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-slate-500"></span> Offline';
    }
  }
}

function initWebRTC() {
  if (typeof JsSIP === 'undefined') {
    console.error('[JsSIP] JsSIP library is not loaded!');
    updateWebRTCStatus('error', 'JsSIP Missing');
    showToast('JsSIP library failed to load', 'error');
    return;
  }

  if (!currentUser || !currentUser.order_id || !currentUser.sip_password) {
    console.warn('WebRTC cannot start: missing user SIP credentials');
    updateWebRTCStatus('offline', 'Please Sign In');
    return;
  }

  // Disconnect previous instance cleanly if present
  disconnectWebRTC();

  activeSocketUrl = getResolvedWsUrl(selectedWsMode);
  const activeSocketLabel = document.getElementById('activeSocketLabel');
  if (activeSocketLabel) activeSocketLabel.textContent = activeSocketUrl;

  const sipDomain = '192.168.88.47';
  const ext = String(currentUser.order_id);
  const secret = String(currentUser.sip_password);

  console.log(`[JsSIP] Starting softphone for Ext ${ext}@${sipDomain} via ${activeSocketUrl}...`);
  updateWebRTCStatus('connecting', 'Connecting...');

  try {
    const socket = new JsSIP.WebSocketInterface(activeSocketUrl);

    const configuration = {
      sockets: [socket],
      uri: `sip:${ext}@${sipDomain}`,
      password: secret,
      display_name: currentUser.name || `User ${ext}`,
      session_timers: false,
      register: true,
      register_expires: 120
    };

    window.ua = new JsSIP.UA(configuration);

    window.ua.on('connecting', () => {
      console.log('[JsSIP] WebSocket Connecting to:', activeSocketUrl);
      updateWebRTCStatus('connecting', 'Connecting...');
    });

    window.ua.on('connected', () => {
      console.log('[JsSIP] WebSocket Connected to:', activeSocketUrl);
      updateWebRTCStatus('connecting', 'Authenticating...');
    });

    window.ua.on('disconnected', (e) => {
      console.warn('[JsSIP] WebSocket Disconnected:', e);
      updateWebRTCStatus('offline', 'Disconnected');

      // Auto fallback to proxy if direct_wss fails
      if (selectedWsMode === 'direct_wss') {
        console.warn('[JsSIP] direct_wss failed, falling back to proxy...');
        selectedWsMode = 'proxy';
        const wsSelect = document.getElementById('wsUrlSelect');
        if (wsSelect) wsSelect.value = 'proxy';
        setTimeout(() => initWebRTC(), 1500);
      }
    });

    window.ua.on('registered', () => {
      console.log(`[JsSIP] Extension ${ext} Registered Successfully!`);
      updateWebRTCStatus('online', `Registered (${ext})`);
      showToast(`SipMyNumber UID ${ext} Online!`, 'success');
    });

    window.ua.on('unregistered', () => {
      console.log('[JsSIP] Unregistered');
      updateWebRTCStatus('offline', 'Offline');
    });

    window.ua.on('registrationFailed', (e) => {
      console.error('[JsSIP] Registration Failed:', e.cause);
      updateWebRTCStatus('error', `Auth Error (${e.cause || 'Secret'})`);
      showToast(`Registration Failed: ${e.cause || 'Invalid Credentials'}`, 'error');
    });

    // Incoming & Outgoing Sessions
    window.ua.on('newRTCSession', (e) => {
      const session = e.session;
      console.log('[JsSIP] New RTC Session:', session.direction, session.remote_identity.uri.toString());

      if (session.direction === 'incoming') {
        handleIncomingCall(session);
      } else {
        attachSessionListeners(session);
      }
    });

    window.ua.start();
  } catch (err) {
    console.error('[JsSIP] Initialization error:', err);
    updateWebRTCStatus('error', err.message || 'Init Error');
    showToast('WebRTC Error: ' + err.message, 'error');
  }
}

function reconnectWebRTC() {
  showToast('Reconnecting WebRTC softphone...', 'info');
  initWebRTC();
}

function attachSessionListeners(session) {
  if (!session) return;
  if (session._listenersAttached) return;
  session._listenersAttached = true;
  window.currentSession = session;

  session.on('connecting', () => {
    console.log('[Call] Connecting...');
    updateWebRTCStatus('in-call', 'Calling...');
    showActiveCallBar(session.remote_identity.displayName || session.remote_identity.uri.user || 'Unknown');
  });

  session.on('progress', (e) => {
    console.log('[Call] Progress / Ringing...');
    updateWebRTCStatus('in-call', 'Ringing...');
  });

  session.on('confirmed', () => {
    console.log('[Call] Answered & Connected');
    updateWebRTCStatus('in-call', 'In Call');
    showActiveCallBar(session.remote_identity.displayName || session.remote_identity.uri.user || 'Connected');
    startCallTimer();
    attachRemoteAudio(session);
  });

  session.on('ended', (e) => {
    console.log('[Call] Ended. Cause:', e.cause);
    const modal = document.getElementById('incomingCallModal');
    if (modal) modal.classList.add('hidden');
    pendingIncomingSession = null;
    logCdr(session, e.cause || 'COMPLETED');
    cleanupCall();
  });

  session.on('failed', (e) => {
    console.log('[Call] Failed. Cause:', e.cause);
    const modal = document.getElementById('incomingCallModal');
    if (modal) modal.classList.add('hidden');
    pendingIncomingSession = null;
    showToast(`Call Failed: ${e.cause}`, 'error');
    logCdr(session, e.cause || 'FAILED');
    cleanupCall();
  });

  session.on('peerconnection:setremotedescriptionfailed', (err) => {
    console.error('[WebRTC] setRemoteDescription failed:', err);
    showToast('SDP Error: ' + (err && err.message ? err.message : err), 'error');
  });

  session.on('peerconnection:createanswerfailed', (err) => {
    console.error('[WebRTC] createAnswer failed:', err);
    showToast('WebRTC Answer Error: ' + (err && err.message ? err.message : err), 'error');
  });

  session.on('sdp', (e) => {
    console.log('[WebRTC] SDP (' + e.originator + ' ' + e.type + '):\n' + e.sdp);
  });

  // Attach WebRTC PeerConnection listeners safely (handles track & addstream)
  const setupPeerConnection = (pc) => {
    if (!pc || pc._pcListenersAttached) return;
    pc._pcListenersAttached = true;

    pc.addEventListener('track', (e) => {
      console.log('[WebRTC] Remote track received:', e.track ? e.track.kind : 'audio');
      const remoteAudio = document.getElementById('remoteAudio');
      if (e.streams && e.streams[0]) {
        playDirectAudio(e.streams[0], remoteAudio);
      } else if (e.track) {
        const ms = new MediaStream([e.track]);
        playDirectAudio(ms, remoteAudio);
      }
    });

    pc.addEventListener('addstream', (e) => {
      console.log('[WebRTC] Remote stream added');
      const remoteAudio = document.getElementById('remoteAudio');
      playDirectAudio(e.stream, remoteAudio);
    });
  };

  // When JsSIP creates the RTCPeerConnection (standard for incoming calls on answer):
  session.on('peerconnection', (data) => {
    console.log('[Call] RTCPeerConnection event received from JsSIP');
    setupPeerConnection(data.peerconnection);
  });

  // If RTCPeerConnection already exists (e.g. outgoing calls):
  if (session.connection) {
    setupPeerConnection(session.connection);
  }
}

function playDirectAudio(stream, remoteAudio) {
  if (!stream || !remoteAudio) return;
  console.log('[WebRTC] Attaching direct raw audio stream:', stream.id);

  remoteAudio.muted = false;
  remoteAudio.volume = 1.0;

  if (remoteAudio.srcObject !== stream) {
    remoteAudio.srcObject = stream;
  }

  // Ensure all audio tracks are active and unmuted
  const tracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
  tracks.forEach(track => {
    track.enabled = true;
    console.log('[WebRTC] Remote track ready:', track.id, 'enabled:', track.enabled, 'muted:', track.muted);
  });

  const p = remoteAudio.play();
  if (p !== undefined) {
    p.then(() => {
      console.log('[WebRTC] Remote audio playback running successfully');
    }).catch(err => {
      console.warn('[WebRTC] Remote audio play warning:', err);
    });
  }
}

function attachRemoteAudio(session) {
  const remoteAudio = document.getElementById('remoteAudio');
  if (!remoteAudio) return;

  const connection = session ? session.connection : null;
  if (!connection) return;

  const streams = connection.getRemoteStreams ? connection.getRemoteStreams() : [];
  if (streams.length > 0 && streams[0].getTracks().length > 0) {
    playDirectAudio(streams[0], remoteAudio);
  } else {
    const receivers = connection.getReceivers ? connection.getReceivers() : [];
    const mediaStream = new MediaStream();
    receivers.forEach(r => {
      if (r.track) mediaStream.addTrack(r.track);
    });
    if (mediaStream.getTracks().length > 0) {
      playDirectAudio(mediaStream, remoteAudio);
    }
  }
}

function initiateCall() {
  if (!window.ua || !window.ua.isRegistered()) {
    showToast('Softphone is offline. Connecting...', 'error');
    if (currentUser) initWebRTC();
    else applyAuthState(false);
    return;
  }

  // STRICT BALANCE GUARD: Zero or negative balance blocks all calls
  const currentBal = parseFloat(currentUser?.balance || 0);
  if (currentBal <= 0) {
    showToast(`Call Blocked: Your balance is $${currentBal.toFixed(2)}. Please recharge your account to make calls.`, 'error');
    console.warn(`[Balance Guard] Call BLOCKED: Extension ${currentUser?.order_id} has balance $${currentBal.toFixed(2)}`);
    return;
  }

  const dialInput = document.getElementById('dialInput');
  const target = dialInput.value.trim();

  if (!target) {
    showToast('Enter a destination UID or number', 'error');
    return;
  }

  // STRICT DESTINATION TALKTIME GUARD
  const cleanTarget = target.replace(/[^0-9]/g, '');
  if (cleanTarget && cleanTarget.length >= 2 && allRatesCache && allRatesCache.length > 0) {
    let longestMatch = -1;
    let matchedRate = null;
    for (const r of allRatesCache) {
      if (cleanTarget.startsWith(String(r.country_code)) && String(r.country_code).length > longestMatch) {
        longestMatch = String(r.country_code).length;
        matchedRate = r;
      }
    }
    if (matchedRate) {
      const requiredRate = parseFloat(matchedRate.rate_per_minute);
      if (currentBal < requiredRate) {
        showToast(`Call Blocked: Insufficient talktime for ${matchedRate.country_name} (Rate: ${requiredRate.toFixed(4)}/min). Current balance: ${currentBal.toFixed(2)}.`, 'error');
        console.warn(`[Talktime Guard] Call BLOCKED: Balance ${currentBal} < Rate ${requiredRate}`);
        return;
      }
    }
  }

  const sipDomain = '192.168.88.47';
  const targetUri = target.includes('@') ? target : `sip:${target}@${sipDomain}`;

  console.log(`[Call] Dialing ${targetUri}...`);

  const eventHandlers = {
    progress: (e) => console.log('Call is in progress'),
    failed: (e) => console.log('Call failed: ', e),
    ended: (e) => console.log('Call ended: ', e),
    confirmed: (e) => console.log('Call confirmed')
  };

  const options = {
    eventHandlers: eventHandlers,
    mediaConstraints: {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    },
    rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false }
  };

  try {
    const session = window.ua.call(targetUri, options);
    attachSessionListeners(session);
  } catch (err) {
    console.error('Call launch error:', err);
    showToast('Failed to start call: ' + err.message, 'error');
  }
}

function handleIncomingCall(session) {
  pendingIncomingSession = session;
  const caller = session.remote_identity.displayName || session.remote_identity.uri.user || 'Unknown Caller';
  const callerElem = document.getElementById('incomingCallerId');
  if (callerElem) callerElem.textContent = caller;

  const modal = document.getElementById('incomingCallModal');
  if (modal) modal.classList.remove('hidden');

  // Attach session listeners immediately so progress, failed, ended are handled
  attachSessionListeners(session);

  session.on('ended', () => {
    if (modal) modal.classList.add('hidden');
    pendingIncomingSession = null;
    cleanupCall();
  });

  session.on('failed', () => {
    if (modal) modal.classList.add('hidden');
    pendingIncomingSession = null;
    cleanupCall();
  });
}

function answerIncomingCall() {
  if (!pendingIncomingSession) {
    console.warn('[Call] No pending incoming call to answer');
    return;
  }

  const session = pendingIncomingSession;
  pendingIncomingSession = null;

  const modal = document.getElementById('incomingCallModal');
  if (modal) modal.classList.add('hidden');

  // Pre-unlock audio element within user click gesture
  const remoteAudio = document.getElementById('remoteAudio');
  if (remoteAudio) {
    remoteAudio.muted = false;
    remoteAudio.volume = 1.0;
    remoteAudio.play().catch(() => {});
  }

  attachSessionListeners(session);

  const options = {
    mediaConstraints: {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    }
  };

  try {
    session.answer(options);
    console.log('[Call] session.answer() called successfully');
    showActiveCallBar(session.remote_identity.displayName || session.remote_identity.uri.user || 'Incoming Caller');
    updateWebRTCStatus('in-call', 'Answering...');
  } catch (err) {
    console.error('[Call] Error answering incoming call:', err);
    showToast('Failed to answer call: ' + err.message, 'error');
  }
}

function rejectIncomingCall() {
  if (pendingIncomingSession) {
    try {
      pendingIncomingSession.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
    } catch (e) {
      console.warn('[Call] Error terminating incoming call:', e);
    }
    pendingIncomingSession = null;
  }
  const modal = document.getElementById('incomingCallModal');
  if (modal) modal.classList.add('hidden');
}

function hangupCall() {
  if (window.currentSession) {
    window.currentSession.terminate();
  }
  cleanupCall();
}

function toggleMute() {
  if (!window.currentSession) return;
  const muteBtn = document.getElementById('callMuteBtn');
  const muteText = document.getElementById('muteBtnText');

  if (isMuted) {
    window.currentSession.unmute({ audio: true });
    isMuted = false;
    muteBtn.className = 'px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-sm font-semibold flex items-center gap-2 transition-all';
    muteText.textContent = 'Mute';
    showToast('Microphone Unmuted', 'info');
  } else {
    window.currentSession.mute({ audio: true });
    isMuted = true;
    muteBtn.className = 'px-4 py-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40 text-sm font-semibold flex items-center gap-2 transition-all';
    muteText.textContent = 'Unmute';
    showToast('Microphone Muted', 'info');
  }
}

function showActiveCallBar(target) {
  document.getElementById('activeCallTarget').textContent = target;
  document.getElementById('activeCallTimer').textContent = '00:00';
  document.getElementById('activeCallBar').classList.remove('hidden');
}

function startCallTimer() {
  callStartTime = Date.now();
  if (callTimerInterval) clearInterval(callTimerInterval);
  callTimerInterval = setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - callStartTime) / 1000);
    const m = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
    const s = String(elapsedSeconds % 60).padStart(2, '0');
    document.getElementById('activeCallTimer').textContent = `${m}:${s}`;
  }, 1000);
}

function cleanupCall() {
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
  callStartTime = null;
  window.currentSession = null;
  isMuted = false;

  document.getElementById('activeCallBar').classList.add('hidden');
  const remoteAudio = document.getElementById('remoteAudio');
  if (remoteAudio) {
    remoteAudio.pause();
    remoteAudio.srcObject = null;
  }

  if (window.ua && window.ua.isRegistered()) {
    updateWebRTCStatus('online', `Registered (${currentUser.order_id})`);
  } else {
    updateWebRTCStatus('offline', 'Offline');
  }
}

async function logCdr(session, disposition) {
  if (!authToken || !currentUser) return;
  const caller = session.direction === 'outgoing' ? currentUser.order_id : (session.remote_identity.uri.user || 'External');
  const callee = session.direction === 'outgoing' ? (session.remote_identity.uri.user || 'Unknown') : currentUser.order_id;
  const duration = callStartTime ? Math.floor((Date.now() - callStartTime) / 1000) : 0;

  try {
    await fetch('/api/cdrs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        caller: String(caller),
        callee: String(callee),
        duration,
        disposition: String(disposition).toUpperCase(),
        cost: 0.00
      })
    });
  } catch (err) {
    console.error('Failed to log CDR:', err);
  }
}

// ============================================================================
// Dialer Controls & Audio Feedback (Keypad DTMF)
// ============================================================================
function playTone(key) {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const freqs = DTMF_FREQS[key];
    if (!freqs) return;

    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc1.type = 'sine';
    osc2.type = 'sine';
    osc1.frequency.value = freqs[0];
    osc2.frequency.value = freqs[1];

    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(audioCtx.destination);

    osc1.start();
    osc2.start();
    osc1.stop(audioCtx.currentTime + 0.12);
    osc2.stop(audioCtx.currentTime + 0.12);
  } catch (e) {}
}

function pressDigit(digit) {
  pressKey(digit);
}

function pressKey(key) {
  playTone(key);
  const input = document.getElementById('dialInput');
  if (input) {
    input.value += key;
    input.focus();
  }

  if (window.currentSession && window.currentSession.isInProgress && !window.currentSession.isEnded()) {
    try {
      window.currentSession.sendDTMF(key);
      console.log('[DTMF] Sent:', key);
    } catch (e) {
      console.warn('DTMF send error:', e);
    }
  }
}

function backspaceDial() {
  const input = document.getElementById('dialInput');
  input.value = input.value.slice(0, -1);
}

function clearDial() {
  document.getElementById('dialInput').value = '';
}

function quickDial(number) {
  document.getElementById('dialInput').value = number;
  initiateCall();
}

// ============================================================================
// Navigation Tabs
// ============================================================================
let currentTab = 'dialer';

function switchTab(tabId) {
  const isAdmin = Boolean(currentUser && (currentUser.is_admin === 1 || currentUser.is_admin === true || currentUser.role === 'admin'));

  // Admin is strictly for Account & CRM Management: no dialer, marketplace, voicemails, forwarding, rates, or personal cdrs
  if (isAdmin && tabId !== 'admin') {
    tabId = 'admin';
  }

  if (tabId === 'admin' && !isAdmin) {
    showToast('Admin privileges required', 'error');
    return switchTab('dialer');
  }

  currentTab = tabId;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));

  // Update left sidebar active styling for Customer tabs
  const customerNavTabs = ['dialer', 'marketplace', 'routes', 'voicemails', 'rates', 'cdrs'];
  customerNavTabs.forEach(t => {
    const btn = document.getElementById(`sideNav-${t}`);
    if (btn) {
      if (t === tabId) {
        btn.className = 'w-full text-left px-3 py-2 rounded bg-[#244853] text-white text-xs font-bold flex items-center justify-between border-l-4 border-[#8ae088] shadow-inner';
      } else {
        btn.className = 'w-full text-left px-3 py-2 rounded bg-[#2f5b68] hover:bg-[#244853] text-xs font-semibold flex items-center justify-between transition-colors';
      }
    }
  });

  const activeContent = document.getElementById(`tab-${tabId}`);
  if (activeContent) activeContent.classList.remove('hidden');

  if (tabId === 'marketplace') fetchAvailableDids();
  if (tabId === 'routes') fetchMyDids();
  if (tabId === 'cdrs') fetchCdrs();
  if (tabId === 'voicemails') fetchVoicemails();
  if (tabId === 'rates') fetchRates();
  if (tabId === 'admin') switchAdminSubtab(currentAdminSubtab || 'users');
}

// ============================================================================
// Number Marketplace
// ============================================================================
async function fetchAvailableDids() {
  if (!authToken) return;
  const list = document.getElementById('marketplaceList');
  list.innerHTML = '<div class="col-span-3 text-center py-12 text-slate-400"><i class="fa-solid fa-spinner fa-spin text-xl mr-2"></i>Loading inventory...</div>';

  try {
    const res = await fetch('/api/dids/available', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (data.dids.length === 0) {
      list.innerHTML = '<div class="col-span-3 text-center py-12 text-slate-400">No numbers currently available. Check back soon.</div>';
      return;
    }

    list.innerHTML = data.dids.map(did => `
      <div class="bg-white border border-slate-300 rounded shadow-sm p-4 hover:shadow-md transition-shadow flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between pb-2 mb-2 border-b border-slate-200">
            <span class="text-xs font-bold text-slate-700 uppercase">
              <i class="fa-solid fa-globe text-[#28b67a] mr-1"></i>${did.country}
            </span>
            <span class="font-mono font-bold text-emerald-600 text-sm">$${parseFloat(did.monthly_cost).toFixed(2)}/mo</span>
          </div>
          <div class="my-2">
            <span class="bg-[#1d68d8] text-white px-2.5 py-1 rounded font-mono font-bold text-sm inline-block shadow-sm">
              ${did.did_number}
            </span>
          </div>
          <p class="text-xs text-slate-500 mb-3">Asterisk 20 PJSIP & DID Forwarding Ready</p>
        </div>
        <button onclick="purchaseDid(${did.id}, '${did.did_number}', ${did.monthly_cost})" class="w-full py-2 rounded bg-[#28b67a] hover:bg-[#229c67] text-white font-bold text-xs shadow flex items-center justify-center gap-1.5 transition-colors">
          <i class="fa-solid fa-cart-plus"></i>
          <span>Order Number ($${parseFloat(did.monthly_cost).toFixed(2)})</span>
        </button>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<div class="col-span-3 text-center py-12 text-rose-400">Failed to load marketplace: ${err.message}</div>`;
  }
}

async function purchaseDid(didId, didNumber, cost) {
  if (!confirm(`Confirm purchase of ${didNumber} for $${parseFloat(cost).toFixed(2)}/month?`)) return;

  try {
    const res = await fetch('/api/dids/purchase', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ did_id: didId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentUser.balance = data.new_balance;
    localStorage.setItem('vpl_user', JSON.stringify(currentUser));
    applyAuthState(true);

    showToast(`Number ${didNumber} purchased! Assigned to UID ${currentUser.order_id}`, 'success');
    fetchAvailableDids();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================================
// DID Routing & Forwarding Manager
// ============================================================================
async function fetchMyDids() {
  if (!authToken) return;
  const tbody = document.getElementById('myDidsTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading configured routes...</td></tr>';
  }

  try {
    const res = await fetch('/api/dids/my', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (data.dids.length === 0) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-500">You have no phone numbers yet. Visit the Number Marketplace to buy one!</td></tr>';
      return;
    }

    const myExt = String(currentUser?.order_id || '2001');

    tbody.innerHTML = data.dids.map(item => {
      let typeBadge = '';
      if (item.forward_type === 'PSTN') {
        typeBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200"><i class="fa-solid fa-mobile-screen mr-1"></i>Mobile / PSTN</span>`;
      } else if (String(item.forward_destination) === myExt || /^[0-9]{4,6}$/.test(item.forward_destination)) {
        typeBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200"><i class="fa-solid fa-headset mr-1"></i>Incoming: My Softphone (UID ${item.forward_destination})</span>`;
      } else {
        typeBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200"><i class="fa-solid fa-network-wired mr-1"></i>External SIP IP / PBX</span>`;
      }

      return `
      <tr class="hover:bg-slate-50 transition-colors bg-white">
        <td class="py-3 px-4 text-center"><input type="checkbox" class="rounded"></td>
        <td class="py-3 px-4">
          <span class="bg-[#1d68d8] text-white px-2.5 py-0.5 rounded font-mono font-bold text-xs inline-block">
            ${escapeHtml(item.did_number)}
          </span>
        </td>
        <td class="py-3 px-4 text-slate-700 font-semibold">${escapeHtml(item.country)}</td>
        <td class="py-3 px-4">${typeBadge}</td>
        <td class="py-3 px-4 font-mono font-bold text-slate-800">${escapeHtml(item.forward_destination)}</td>
        <td class="py-3 px-4">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Active</span>
        </td>
        <td class="py-3 px-4 text-right">
          <button onclick="openRouteModal(${item.user_did_id}, '${escapeHtml(item.did_number)}', '${item.forward_type}', '${escapeHtml(item.forward_destination)}', ${item.voicemail_enabled !== undefined ? item.voicemail_enabled : 1}, ${item.voicemail_timeout !== undefined ? item.voicemail_timeout : 20})" class="px-2.5 py-1 rounded bg-[#366877] hover:bg-[#2d5764] text-white text-xs font-bold transition-colors">
            <i class="fa-solid fa-pen-to-square mr-1"></i>Configure Route
          </button>
        </td>
      </tr>`;
    }).join('');
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-rose-500">Failed to load routes: ${escapeHtml(err.message)}</td></tr>`;
  }
}

let currentRouteMode = 'EXTENSION';

function selectRouteMode(mode) {
  currentRouteMode = mode;
  const radioExt = document.getElementById('routeRadio-EXTENSION');
  const radioPstn = document.getElementById('routeRadio-PSTN');
  const radioSip = document.getElementById('routeRadio-SIP_IP');

  const cardExt = document.getElementById('routeCard-EXTENSION');
  const cardPstn = document.getElementById('routeCard-PSTN');
  const cardSip = document.getElementById('routeCard-SIP_IP');

  const fieldPstn = document.getElementById('routePstnField');
  const fieldSip = document.getElementById('routeSipIpField');

  const vmBox = document.getElementById('routeVoicemailBox');
  const vmCheck = document.getElementById('routeVoicemailEnabled');
  const vmBadge = document.getElementById('routeVoicemailBadge');
  const vmNote = document.getElementById('routeVoicemailNote');
  const vmTimeoutContainer = document.getElementById('voicemailTimeoutContainer');
  const vmTimeoutSel = document.getElementById('routeVoicemailTimeout');

  if (radioExt) radioExt.checked = (mode === 'EXTENSION');
  if (radioPstn) radioPstn.checked = (mode === 'PSTN');
  if (radioSip) radioSip.checked = (mode === 'SIP_IP');

  if (cardExt) cardExt.className = (mode === 'EXTENSION') ? 'p-3.5 rounded border-2 border-[#28b67a] bg-emerald-50/50 cursor-pointer transition-all shadow-sm' : 'p-3.5 rounded border border-slate-300 bg-white cursor-pointer transition-all hover:border-slate-400';
  if (cardPstn) cardPstn.className = (mode === 'PSTN') ? 'p-3.5 rounded border-2 border-amber-500 bg-amber-50/40 cursor-pointer transition-all shadow-sm' : 'p-3.5 rounded border border-slate-300 bg-white cursor-pointer transition-all hover:border-slate-400';
  if (cardSip) cardSip.className = (mode === 'SIP_IP') ? 'p-3.5 rounded border-2 border-indigo-500 bg-indigo-50/40 cursor-pointer transition-all shadow-sm' : 'p-3.5 rounded border border-slate-300 bg-white cursor-pointer transition-all hover:border-slate-400';

  if (fieldPstn) {
    if (mode === 'PSTN') {
      fieldPstn.classList.remove('hidden');
      const input = document.getElementById('routeInputPstn');
      if (input) input.focus();
    } else {
      fieldPstn.classList.add('hidden');
    }
  }
  if (fieldSip) {
    if (mode === 'SIP_IP') {
      fieldSip.classList.remove('hidden');
      const input = document.getElementById('routeInputSipIp');
      if (input) input.focus();
    } else {
      fieldSip.classList.add('hidden');
    }
  }

  // Strict Voicemail Rule:
  // ONLY WebRTC lines have Voicemail enabled (default active).
  // SIP fwd & PSTN fwd MUST have Voicemail DISABLED and LOCKED (could not be enabled).
  if (mode === 'EXTENSION') {
    if (vmBox) vmBox.className = 'p-3.5 rounded border border-amber-300 bg-amber-50/70 space-y-2 transition-all';
    if (vmCheck) {
      vmCheck.disabled = false;
      vmCheck.checked = true; // Enabled by default on WebRTC line
    }
    if (vmBadge) {
      vmBadge.textContent = 'Audio Greeting + Beep';
      vmBadge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-200/80 text-amber-900 border border-amber-300';
    }
    if (vmNote) {
      vmNote.textContent = 'If you do not answer within the timeout (or phone is offline), caller hears an audio prompt, records a voicemail message after the beep, and it is saved to your portal.';
    }
    if (vmTimeoutContainer) vmTimeoutContainer.classList.remove('hidden');
    if (vmTimeoutSel) vmTimeoutSel.disabled = false;
  } else {
    // PSTN or SIP FWD: Disable and lock voicemail
    if (vmBox) vmBox.className = 'p-3.5 rounded border border-slate-200 bg-slate-100 opacity-60 space-y-2 transition-all';
    if (vmCheck) {
      vmCheck.checked = false; // Forced unchecked
      vmCheck.disabled = true;  // Locked - cannot be enabled
    }
    if (vmBadge) {
      vmBadge.textContent = 'Voicemail Disabled (WebRTC Only)';
      vmBadge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-200 text-slate-600 border border-slate-300';
    }
    if (vmNote) {
      vmNote.textContent = 'Voicemail is disabled and unavailable for PSTN / External SIP Forwarding. Call handling and voicemail is managed by the destination external line.';
    }
    if (vmTimeoutContainer) vmTimeoutContainer.classList.add('hidden');
    if (vmTimeoutSel) vmTimeoutSel.disabled = true;
  }
}

function openRouteModal(userDidId, didNumber, type, dest, vmEnabled, vmTimeout) {
  document.getElementById('routeModalUserDidId').value = userDidId;
  const numberElem = document.getElementById('routeModalDidNumber');
  if (numberElem) numberElem.textContent = didNumber;

  const myExt = String(currentUser?.order_id || '2001');
  const extElem = document.getElementById('routeModalMyExt');
  if (extElem) extElem.textContent = myExt;

  const inputPstn = document.getElementById('routeInputPstn');
  const inputSip = document.getElementById('routeInputSipIp');
  const vmTimeoutSel = document.getElementById('routeVoicemailTimeout');
  if (vmTimeoutSel) vmTimeoutSel.value = (vmTimeout !== undefined && vmTimeout !== null) ? String(vmTimeout) : '20';

  if (type === 'PSTN') {
    selectRouteMode('PSTN');
    if (inputPstn) inputPstn.value = dest;
    if (inputSip) inputSip.value = '';
  } else if (String(dest) === myExt || /^[0-9]{4,6}$/.test(dest)) {
    selectRouteMode('EXTENSION');
    const vmCheck = document.getElementById('routeVoicemailEnabled');
    if (vmCheck) vmCheck.checked = (vmEnabled === 1 || vmEnabled === true || vmEnabled === undefined || vmEnabled === null || vmEnabled === '1');
    if (inputPstn) inputPstn.value = '';
    if (inputSip) inputSip.value = '';
  } else {
    selectRouteMode('SIP_IP');
    if (inputSip) inputSip.value = dest;
    if (inputPstn) inputPstn.value = '';
  }

  document.getElementById('routeModal').classList.remove('hidden');
}

function closeRouteModal() {
  document.getElementById('routeModal').classList.add('hidden');
}

async function saveRoute(event) {
  if (event && event.preventDefault) event.preventDefault();
  
  const userDidId = document.getElementById('routeModalUserDidId').value;
  const myExt = String(currentUser?.order_id || '2001');

  let forwardType = 'SIP_URI';
  let forwardDestination = myExt;

  if (currentRouteMode === 'EXTENSION') {
    forwardType = 'SIP_URI';
    forwardDestination = myExt;
  } else if (currentRouteMode === 'PSTN') {
    forwardType = 'PSTN';
    const inputPstn = document.getElementById('routeInputPstn');
    forwardDestination = inputPstn ? inputPstn.value.trim() : '';
    if (!forwardDestination) {
      showToast('Please enter a mobile or landline phone number', 'error');
      return;
    }
  } else if (currentRouteMode === 'SIP_IP') {
    forwardType = 'SIP_URI';
    const inputSip = document.getElementById('routeInputSipIp');
    forwardDestination = inputSip ? inputSip.value.trim() : '';
    if (!forwardDestination) {
      showToast('Please enter an external SIP IP address or URI', 'error');
      return;
    }
  }

  const isWebRtc = (currentRouteMode === 'EXTENSION');
  const vmEnabled = isWebRtc ? (document.getElementById('routeVoicemailEnabled')?.checked ? 1 : 0) : 0;
  const vmTimeout = parseInt(document.getElementById('routeVoicemailTimeout')?.value || '20', 10);

  const btnSubmit = document.getElementById('btnSaveRouteSubmit');
  if (btnSubmit) btnSubmit.disabled = true;

  try {
    const res = await fetch('/api/dids/forward', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        user_did_id: userDidId,
        forward_type: forwardType,
        forward_destination: forwardDestination,
        voicemail_enabled: vmEnabled,
        voicemail_timeout: vmTimeout
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update forwarding');

    showToast(`DID Route updated: Delivering to ${forwardDestination}`, 'success');
    closeRouteModal();
    fetchMyDids();
    fetchSubscriberIncomingDids();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btnSubmit) btnSubmit.disabled = false;
  }
}

// Backward compatibility alias
function saveDidRoute() {
  return saveRoute();
}

async function fetchCdrs() {
  if (!authToken) return;
  const tbody = document.getElementById('cdrsTableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading CDRs...</td></tr>';

  try {
    const res = await fetch('/api/cdrs', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (data.cdrs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-slate-400">No calls recorded yet. Make a test call!</td></tr>';
      return;
    }

    tbody.innerHTML = data.cdrs.map(c => `
      <tr class="hover:bg-slate-50 transition-colors bg-white">
        <td class="py-3 px-4 text-center"><input type="checkbox" class="rounded"></td>
        <td class="py-3 px-4 font-mono font-bold text-[#28b67a]">
          <i class="fa-solid fa-arrow-up-right-from-square text-xs mr-1 text-slate-400"></i>${c.caller}
        </td>
        <td class="py-3 px-4">
          <span class="bg-[#1d68d8] text-white px-2 py-0.5 rounded font-mono font-bold text-xs inline-block">
            ${c.callee}
          </span>
        </td>
        <td class="py-3 px-4 font-mono text-slate-700">${c.duration}s</td>
        <td class="py-3 px-4">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${c.disposition === 'ANSWERED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}">
            ${c.disposition}
          </span>
        </td>
        <td class="py-3 px-4 font-mono font-bold text-emerald-600">$${parseFloat(c.cost || 0).toFixed(2)}</td>
        <td class="py-3 px-4 text-right text-slate-500 font-mono text-xs">
          ${c.created_at ? new Date(c.created_at).toLocaleString() : '--'}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-rose-400">Failed to load CDRs: ${err.message}</td></tr>`;
  }
}

// ============================================================================
// Toast Notification
// ============================================================================
let toastTimeout = null;
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toastText');
  const toastIcon = document.getElementById('toastIcon');

  if (!toast || !toastText || !toastIcon) return;

  toastText.textContent = message;
  toastIcon.className = 'text-lg ';

  if (type === 'success') {
    toastIcon.className += 'fa-solid fa-circle-check text-emerald-400';
  } else if (type === 'error') {
    toastIcon.className += 'fa-solid fa-circle-exclamation text-rose-400';
  } else {
    toastIcon.className += 'fa-solid fa-circle-info text-cyan-400';
  }

  toast.classList.remove('translate-y-24', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.add('translate-y-24', 'opacity-0');
    toast.classList.remove('translate-y-0', 'opacity-100');
  }, 4000);
}

// ============================================================================
// Admin Portal & User Management (CRUD + Asterisk Sync)
// ============================================================================
let adminUsersList = [];
let passwordVisibilityMap = {};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function fetchAdminUsers() {
  if (!authToken) return;
  const tbody = document.getElementById('adminUsersTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading customers and UIDs...</td></tr>';
  }

  try {
    const res = await fetch('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch users');

    adminUsersList = data.users || [];

    // Update KPI Summary Badges
    const statUsers = document.getElementById('adminStatTotalUsers');
    const statActive = document.getElementById('adminStatActiveExt');
    const statBal = document.getElementById('adminStatTotalBalance');
    const statDids = document.getElementById('adminStatTotalDids');

    if (statUsers) statUsers.textContent = data.summary.total_users || adminUsersList.length;
    if (statActive) statActive.textContent = data.summary.active_extensions || 0;
    if (statBal) statBal.textContent = `$${parseFloat(data.summary.total_balance || 0).toFixed(2)}`;
    if (statDids) statDids.textContent = data.summary.total_dids_allocated || 0;
    const statPending = document.getElementById('adminStatPendingRequests');
    if (statPending && data.summary && data.summary.pending_requests !== undefined) {
      statPending.textContent = data.summary.pending_requests;
    }

    renderAdminUsers(adminUsersList);
  } catch (err) {
    console.error('[Admin] Fetch error:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-rose-400"><i class="fa-solid fa-triangle-exclamation mr-2"></i>${escapeHtml(err.message)}</td></tr>`;
    }
    showToast(err.message, 'error');
  }
}

function renderAdminUsers(users) {
  const tbody = document.getElementById('adminUsersTableBody');
  if (!tbody) return;

  if (!users || users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-slate-500">No users found. Click "Add User" to create one.</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => {
    const isVisible = Boolean(passwordVisibilityMap[u.id]);
    const displayPass = isVisible ? escapeHtml(u.sip_password) : '••••••••';
    const eyeIconClass = isVisible ? 'fa-eye' : 'fa-eye-slash';
    const statusBadge = u.sip_status === 'active' 
      ? '<span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">Active</span>'
      : '<span class="px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">Suspended</span>';

    const roleBadge = u.is_admin 
      ? '<span class="ml-1 px-1.5 py-0.2 rounded bg-purple-100 text-purple-800 text-[9px] font-extrabold border border-purple-200">ADMIN</span>' 
      : '';

    const regDate = u.created_at ? new Date(u.created_at).toLocaleDateString() : '--';

    return `
      <tr class="hover:bg-slate-50 transition-colors bg-white">
        <td class="py-3 px-4 text-center"><input type="checkbox" class="rounded"></td>
        <td class="py-3 px-4 font-mono">
          <span class="bg-[#1d68d8] text-white px-2 py-0.5 rounded font-mono font-bold text-xs inline-block">
            UID ${u.order_id || '--'}
          </span>
          <span class="text-[10px] text-slate-400 ml-1">#${u.id}</span>
        </td>
        <td class="py-3 px-4">
          <div class="flex items-center space-x-1.5">
            <button onclick="openEditUserModal(${u.id})" class="text-slate-400 hover:text-slate-600 text-xs" title="Edit">
              <i class="fa-solid fa-pen text-[10px]"></i>
            </button>
            <a href="#" onclick="openEditUserModal(${u.id}); return false;" class="text-[#28b67a] font-bold hover:underline">
              ${escapeHtml(u.name)}
            </a>
            ${roleBadge}
          </div>
        </td>
        <td class="py-3 px-4 font-mono text-xs">
          <span class="dotted-link font-medium">${escapeHtml(u.email)}</span>
        </td>
        <td class="py-3 px-4 font-mono font-bold text-slate-800 text-xs">
          ${u.sip_username}
        </td>
        <td class="py-3 px-4">
          <div class="flex items-center space-x-2">
            <span id="sipSecret-${u.id}" class="font-mono text-xs text-slate-800">${displayPass}</span>
            <button onclick="togglePasswordVisibility(${u.id}, '${escapeHtml(u.sip_password)}')" class="p-1 text-slate-400 hover:text-slate-700 transition-colors" title="Toggle Password">
              <i id="eyeIcon-${u.id}" class="fa-solid ${eyeIconClass} text-xs"></i>
            </button>
          </div>
        </td>
        <td class="py-3 px-4 font-mono font-bold text-emerald-600 text-xs">
          <div class="flex items-center space-x-1.5">
            <span>$${parseFloat(u.balance || 0).toFixed(2)}</span>
            <button onclick="openBalanceModal(${u.id})" class="text-slate-400 hover:text-emerald-600 transition-colors" title="Adjust Balance">
              <i class="fa-solid fa-pen-to-square text-[10px]"></i>
            </button>
          </div>
        </td>
        <td class="py-3 px-4">
          ${statusBadge}
        </td>
        <td class="py-3 px-4 text-slate-500 font-mono text-xs">
          ${regDate}
        </td>
        <td class="py-3 px-4 text-right">
          <div class="flex items-center justify-end space-x-1">
            <button onclick="openCustomer360Modal(${u.id})" class="px-2.5 py-1 rounded bg-[#1d68d8] hover:bg-blue-700 text-white text-xs font-bold transition-colors flex items-center gap-1 shadow-sm" title="Customer 360? Profile & Financial Ledger">
              <i class="fa-solid fa-address-card"></i>
              <span>360?</span>
            </button>
            <button onclick="openEditUserModal(${u.id})" class="px-2 py-1 rounded bg-[#366877] hover:bg-[#2d5764] text-white text-xs font-bold transition-colors" title="Edit User Profile & Password">
              <i class="fa-solid fa-user-pen"></i>
            </button>
            <button onclick="openBalanceModal(${u.id})" class="px-2 py-1 rounded bg-[#28b67a] hover:bg-[#229c67] text-white text-xs font-bold transition-colors" title="Adjust Balance">
              <i class="fa-solid fa-wallet"></i>
            </button>
            <button onclick="handleDeleteUser(${u.id}, '${escapeHtml(u.name)}', ${u.order_id})" class="px-2 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold transition-colors" title="Delete User">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function filterAdminUsers() {
  const query = (document.getElementById('adminSearchInput')?.value || '').toLowerCase().trim();
  if (!query) {
    return renderAdminUsers(adminUsersList);
  }
  const cleanQ = query.replace(/^#/, '').replace(/^(ext|uid)\s*/i, '');
  const filtered = adminUsersList.filter(u => {
    return (
      (u.id && String(u.id) === cleanQ) ||
      (u.name && u.name.toLowerCase().includes(query)) ||
      (u.email && u.email.toLowerCase().includes(query)) ||
      (u.order_id && String(u.order_id).includes(cleanQ)) ||
      (u.sip_username && String(u.sip_username).includes(cleanQ)) ||
      (u.phone && String(u.phone).includes(query))
    );
  });
  renderAdminUsers(filtered);
}

function togglePasswordVisibility(userId, secret) {
  const isVisible = Boolean(passwordVisibilityMap[userId]);
  passwordVisibilityMap[userId] = !isVisible;
  const span = document.getElementById(`sipSecret-${userId}`);
  const icon = document.getElementById(`eyeIcon-${userId}`);
  if (span) {
    span.textContent = !isVisible ? secret : '••••••••';
  }
  if (icon) {
    icon.className = `fa-solid ${!isVisible ? 'fa-eye' : 'fa-eye-slash'} text-xs`;
  }
}

// --- Add User Modal ---
function openAddUserModal() {
  document.getElementById('addUserName').value = '';
  document.getElementById('addUserEmail').value = '';
  document.getElementById('addUserPassword').value = '';
  document.getElementById('addUserBalance').value = '10.00';
  document.getElementById('addUserStatus').value = 'active';
  document.getElementById('addUserIsAdmin').checked = false;
  document.getElementById('modalAddUser').classList.remove('hidden');
}

function closeAddUserModal() {
  document.getElementById('modalAddUser').classList.add('hidden');
}

async function submitAddUser(event) {
  event.preventDefault();
  const btn = document.getElementById('btnAddUserSubmit');
  btn.disabled = true;

  const payload = {
    name: document.getElementById('addUserName').value.trim(),
    email: document.getElementById('addUserEmail').value.trim(),
    password: document.getElementById('addUserPassword').value.trim(),
    initial_balance: parseFloat(document.getElementById('addUserBalance').value) || 10.00,
    status: document.getElementById('addUserStatus').value,
    is_admin: document.getElementById('addUserIsAdmin').checked
  };

  try {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create user');

    closeAddUserModal();
    showToast(`Customer ${data.user.name} created! UID: ${data.user.order_id}`, 'success');
    await fetchAdminUsers();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// --- Edit User Modal ---
function openEditUserModal(userId) {
  const user = adminUsersList.find(u => u.id === userId);
  if (!user) return;

  document.getElementById('editUserId').value = user.id;
  document.getElementById('editUserName').value = user.name;
  document.getElementById('editUserEmail').value = user.email;
  document.getElementById('editUserSipPass').value = '';
  document.getElementById('editUserSipPass').placeholder = 'Enter new password to change... (current: ' + (user.sip_password || '********') + ')';
  document.getElementById('editUserStatus').value = user.sip_status;
  document.getElementById('editUserIsAdmin').checked = Boolean(user.is_admin);
  document.getElementById('editUserExtensionBadge').textContent = `UID ${user.order_id || '--'}`;
  const phoneInput = document.getElementById('editUserPhone');
  const addressInput = document.getElementById('editUserAddress');
  if (phoneInput) phoneInput.value = user.phone || '';
  if (addressInput) addressInput.value = user.address || '';
  const balInput = document.getElementById('editUserBalance');
  if (balInput) balInput.value = parseFloat(user.balance || 0).toFixed(2);

  document.getElementById('modalEditUser').classList.remove('hidden');
}

// Function Aliases for backward compatibility
window.openModalEditUser = openEditUserModal;
window.closeModalEditUser = closeEditUserModal;

function closeEditUserModal() {
  document.getElementById('modalEditUser').classList.add('hidden');
}

async function submitEditUser(event) {
  event.preventDefault();
  const btn = document.getElementById('btnEditUserSubmit');
  btn.disabled = true;

  const userId = document.getElementById('editUserId').value;
  const passVal = document.getElementById('editUserSipPass').value.trim();
  const balVal = document.getElementById('editUserBalance') ? document.getElementById('editUserBalance').value.trim() : null;

  const phoneVal = document.getElementById('editUserPhone') ? document.getElementById('editUserPhone').value.trim() : null;
  const addressVal = document.getElementById('editUserAddress') ? document.getElementById('editUserAddress').value.trim() : null;

  const payload = {
    name: document.getElementById('editUserName').value.trim(),
    email: document.getElementById('editUserEmail').value.trim(),
    phone: phoneVal,
    address: addressVal,
    status: document.getElementById('editUserStatus').value,
    is_admin: document.getElementById('editUserIsAdmin').checked
  };
  if (passVal) payload.sip_password = passVal;
  if (balVal !== null && balVal !== '') payload.balance = parseFloat(balVal);

  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update user');

    closeEditUserModal();
    showToast('User profile updated successfully', 'success');
    await fetchAdminUsers();
    if (currentAdminSubtab === 'customer360' && currentC360UserId) {
      await openCustomer360Modal(currentC360UserId, 'overview');
    }

    if (currentUser && currentUser.id == userId) {
      currentUser.name = payload.name;
      currentUser.email = payload.email;
      currentUser.sip_password = payload.sip_password;
      applyAuthState(true);
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// --- Balance Modal ---
let activeBalanceMode = 'adjust';

function openBalanceModal(userId) {
  const user = adminUsersList.find(u => u.id === userId);
  if (!user) return;

  document.getElementById('balanceUserId').value = user.id;
  document.getElementById('balanceModalUserName').textContent = user.name;
  document.getElementById('balanceModalCurrentAmount').textContent = `$${parseFloat(user.balance || 0).toFixed(2)}`;
  document.getElementById('balanceInputAmount').value = '';

  activeBalanceMode = 'adjust';
  const radio = document.querySelector('input[name="balanceMode"][value="adjust"]');
  if (radio) radio.checked = true;
  toggleBalanceMode();

  document.getElementById('modalUpdateBalance').classList.remove('hidden');
}

function closeBalanceModal() {
  document.getElementById('modalUpdateBalance').classList.add('hidden');
}

function toggleBalanceMode() {
  const selected = document.querySelector('input[name="balanceMode"]:checked')?.value || 'adjust';
  activeBalanceMode = selected;
  const presets = document.getElementById('balancePresetsSection');
  const label = document.getElementById('balanceInputLabel');

  if (selected === 'adjust') {
    if (presets) presets.classList.remove('hidden');
    if (label) label.textContent = 'Adjustment Amount ($ e.g. +20 or -10)';
  } else {
    if (presets) presets.classList.add('hidden');
    if (label) label.textContent = 'Exact Total Balance ($)';
  }
}

function setBalanceAmount(amt) {
  const input = document.getElementById('balanceInputAmount');
  if (input) input.value = amt;
}

async function submitUpdateBalance(event) {
  event.preventDefault();
  const btn = document.getElementById('btnUpdateBalanceSubmit');
  btn.disabled = true;

  const userId = document.getElementById('balanceUserId').value;
  const amount = parseFloat(document.getElementById('balanceInputAmount').value);

  if (isNaN(amount)) {
    btn.disabled = false;
    return showToast('Please enter a valid amount', 'error');
  }

  const payload = {
    type: activeBalanceMode,
    amount: amount
  };

  try {
    const res = await fetch(`/api/admin/users/${userId}/balance`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update balance');

    closeBalanceModal();
    showToast(`Balance updated to $${data.new_balance.toFixed(2)}`, 'success');
    await fetchAdminUsers();

    if (currentUser && currentUser.id == userId) {
      currentUser.balance = data.new_balance;
      applyAuthState(true);
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// --- Delete User Prompt ---
async function deleteUserPrompt(userId, name, orderId) {
  const confirmMsg = `Are you sure you want to permanently delete user "${name}" (UID: ${orderId || 'N/A'})?\n\nThis will remove their database account, release any purchased numbers, and unprovision the UID from Asterisk Media Server.`;
  
  if (!confirm(confirmMsg)) return;

  try {
    showToast('Deleting user and unprovisioning Asterisk...', 'info');
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete user');

    showToast(data.message || 'User deleted successfully', 'success');
    await fetchAdminUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Periodic background balance & session sync (every 20s when logged in)
setInterval(async () => {
  if (authToken && currentUser) {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        const prevBal = parseFloat(currentUser.balance || 0);
        const newBal = parseFloat(data.user?.balance || 0);
        currentUser = { ...currentUser, ...data.user };
        localStorage.setItem('callme_user', JSON.stringify(currentUser));
        localStorage.setItem('vpl_user', JSON.stringify(currentUser));
        applyAuthState(true);
        if (prevBal <= 0 && newBal > 0) {
          showToast(`Account topped up! New balance: $${newBal.toFixed(2)} - Calling enabled`, 'success');
        }
      }
    } catch (e) {}
  }
}, 20000);


// ============================================================================
// Voicemail Handling
// ============================================================================
async function fetchVoicemails() {
  if (!authToken) return;
  const tbody = document.getElementById('voicemailsTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading Voicemails...</td></tr>';
  }

  try {
    const res = await fetch('/api/voicemails', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    updateVoicemailBadge();

    if (!data.voicemails || data.voicemails.length === 0) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-500"><i class="fa-solid fa-voicemail text-slate-300 text-3xl mb-2 block"></i>No voicemail messages yet. When callers leave a message on your DID, it will appear here.</td></tr>';
      return;
    }

    tbody.innerHTML = data.voicemails.map(vm => {
      const isUnread = vm.status === 'unread';
      const statusBadge = isUnread 
        ? `<span id="statusBadge-${vm.id}" class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">NEW</span>`
        : `<span id="statusBadge-${vm.id}" class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">READ</span>`;

      const durationText = formatDuration(vm.duration);
      const formattedDate = new Date(vm.created_at).toLocaleString();

      return `
      <tr id="vm-row-${vm.id}" class="hover:bg-slate-50 transition-colors ${isUnread ? 'bg-amber-50/20' : 'bg-white'}">
        <td class="py-3 px-4">${statusBadge}</td>
        <td class="py-3 px-4 font-mono font-bold text-slate-900">${escapeHtml(vm.caller_id || 'Anonymous')}</td>
        <td class="py-3 px-4">
          <span class="bg-[#1d68d8] text-white px-2 py-0.5 rounded font-mono font-bold text-xs inline-block">
            ${escapeHtml(vm.did_number)}
          </span>
        </td>
        <td class="py-3 px-4 font-mono font-semibold text-slate-700">${durationText}</td>
        <td class="py-3 px-4">
          <audio controls preload="none" onplay="markVoicemailAsRead(${vm.id})" class="h-8 w-64 max-w-full">
            <source src="${vm.audio_url}" type="audio/wav">
            Your browser does not support audio element.
          </audio>
        </td>
        <td class="py-3 px-4 text-slate-500 font-medium text-xs">${formattedDate}</td>
        <td class="py-3 px-4 text-right">
          <button onclick="deleteVoicemail(${vm.id})" class="px-2.5 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold transition-colors">
            <i class="fa-solid fa-trash mr-1"></i>Delete
          </button>
        </td>
      </tr>`;
    }).join('');
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-rose-500">Failed to load voicemails: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function formatDuration(sec) {
  const s = parseInt(sec, 10) || 0;
  const mins = Math.floor(s / 60);
  const remainingSecs = s % 60;
  return `${mins}:${remainingSecs < 10 ? '0' : ''}${remainingSecs}`;
}

async function markVoicemailAsRead(id) {
  try {
    await fetch(`/api/voicemails/${id}/read`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const badge = document.getElementById(`statusBadge-${id}`);
    if (badge) {
      badge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200';
      badge.textContent = 'READ';
    }
    const row = document.getElementById(`vm-row-${id}`);
    if (row) row.classList.remove('bg-amber-50/20');
    updateVoicemailBadge();
  } catch (e) {
    console.error('Failed to mark read', e);
  }
}

async function deleteVoicemail(id) {
  if (!confirm('Are you sure you want to delete this voicemail recording?')) return;
  try {
    const res = await fetch(`/api/voicemails/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Voicemail deleted', 'success');
    const row = document.getElementById(`vm-row-${id}`);
    if (row) row.remove();
    updateVoicemailBadge();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function updateVoicemailBadge() {
  if (!authToken) return;
  try {
    const res = await fetch('/api/voicemails/unread-count', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    const count = parseInt(data.unread_count || 0, 10);

    // 1. Tab Button Badge
    const tabBadge = document.getElementById('unreadVoicemailBadge');
    if (tabBadge) {
      if (count > 0) {
        tabBadge.textContent = count;
        tabBadge.classList.remove('hidden');
      } else {
        tabBadge.classList.add('hidden');
      }
    }

    // 2. Header Notification Pill with Voicemail Icon
    const headerAlert = document.getElementById('voicemailHeaderAlert');
    const headerCount = document.getElementById('headerVmUnreadCount');
    if (headerAlert && headerCount) {
      if (count > 0) {
        headerCount.textContent = count;
        headerAlert.classList.remove('hidden');
      } else {
        headerAlert.classList.add('hidden');
      }
    }

    // 3. Dashboard / Dialer Pending Alert Banner
    const dashBanner = document.getElementById('vmDashboardBanner');
    const bannerCount = document.getElementById('bannerVmUnreadCount');
    if (dashBanner && bannerCount) {
      if (count > 0) {
        bannerCount.textContent = count;
        dashBanner.classList.remove('hidden');
      } else {
        dashBanner.classList.add('hidden');
      }
    }
  } catch (e) {
    // Silent
  }
}

// Auto update notifications every 15 seconds
setInterval(() => {
  if (authToken) updateVoicemailBadge();
}, 15000);

window.handleUpdateUser = submitEditUser;


// ============================================================================
// CUSTOMER BALANCE TOP-UP REQUEST WORKFLOW
// ============================================================================
function openTopupModal(event) {
  if (event) event.stopPropagation();
  const modal = document.getElementById('modalCustomerTopup');
  if (!modal) return;
  modal.classList.remove('hidden');

  const balEl = document.getElementById('topupModalCurrentBal');
  if (balEl && currentUser) {
    balEl.textContent = `$${parseFloat(currentUser.balance || 0).toFixed(2)}`;
  }
  fetchMyBalanceRequests();
}

function closeTopupModal() {
  const modal = document.getElementById('modalCustomerTopup');
  if (modal) modal.classList.add('hidden');
}

function setTopupPreset(amount) {
  const input = document.getElementById('topupInputAmount');
  if (input) input.value = parseFloat(amount).toFixed(2);
}

async function submitTopupRequest(e) {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('topupInputAmount').value);
  const payment_method = document.getElementById('topupPaymentMethod').value;
  const transaction_ref = document.getElementById('topupTxRef').value.trim();
  const notes = document.getElementById('topupNotes').value.trim();

  if (isNaN(amount) || amount <= 0) {
    showToast('Please enter a valid amount greater than $0.00', 'error');
    return;
  }

  const btn = document.getElementById('btnSubmitTopup');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Submitting...';
  }

  try {
    const res = await fetch('/api/balance-requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ amount, payment_method, transaction_ref, notes })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Top-up request submitted! Admin will review and credit shortly.', 'success');
    document.getElementById('topupTxRef').value = '';
    document.getElementById('topupNotes').value = '';
    fetchMyBalanceRequests();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-paper-plane mr-1"></i> Submit Top-up Request';
    }
  }
}

async function fetchMyBalanceRequests() {
  if (!authToken) return;
  const tbody = document.getElementById('myTopupHistoryBody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/balance-requests/my', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (!data.requests || data.requests.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-slate-400 font-sans">No top-up requests yet</td></tr>';
      return;
    }

    tbody.innerHTML = data.requests.map(r => {
      let badge = '';
      if (r.status === 'pending') badge = '<span class="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 font-bold border border-amber-300">Pending</span>';
      else if (r.status === 'approved') badge = '<span class="px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-800 font-bold border border-emerald-300">Approved</span>';
      else badge = '<span class="px-1.5 py-0.5 rounded text-[10px] bg-rose-100 text-rose-800 font-bold border border-rose-300">Rejected</span>';

      const d = new Date(r.created_at);
      const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const ref = r.transaction_ref ? escapeHtml(r.transaction_ref) : '<span class="text-slate-400">--</span>';

      return `<tr>
        <td class="py-2 px-2.5 text-slate-500 font-sans">${dateStr}</td>
        <td class="py-2 px-2.5 font-bold text-emerald-700 font-mono">$${parseFloat(r.amount).toFixed(2)}</td>
        <td class="py-2 px-2.5 text-slate-700 font-sans">${escapeHtml(r.payment_method || 'Bank')}</td>
        <td class="py-2 px-2.5 font-mono text-slate-600">${ref}</td>
        <td class="py-2 px-2.5 font-sans">${badge}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="py-2 text-center text-rose-500 font-sans">Error: ${e.message}</td></tr>`;
  }
}

// ============================================================================
// CALL RATES & TALKTIME CALCULATOR
// ============================================================================
let allRatesCache = [];

async function fetchRatesCache() {
  if (!authToken) return;
  try {
    const res = await fetch('/api/rates', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      allRatesCache = data.rates || [];
    }
  } catch (e) {}
}

async function fetchRates() {
  if (!authToken) return;
  const tbody = document.getElementById('ratesTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading destination rates...</td></tr>';
  }

  try {
    const res = await fetch('/api/rates', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    allRatesCache = data.rates || [];
    renderRatesTable(allRatesCache);
    calculateTalktime();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-rose-500">${err.message}</td></tr>`;
  }
}

function renderRatesTable(rates) {
  const tbody = document.getElementById('ratesTableBody');
  if (!tbody) return;

  const currentBal = parseFloat(currentUser?.balance || 0);

  if (rates.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-slate-400">No destination rates found</td></tr>';
    return;
  }

  tbody.innerHTML = rates.map(r => {
    const rate = parseFloat(r.rate_per_minute);
    const estMins = rate > 0 ? Math.floor(currentBal / rate) : 0;
    const estHrs = (estMins / 60).toFixed(1);
    const talktimeText = estMins > 0 ? `${estMins} mins (~${estHrs} hrs)` : '<span class="text-rose-500 font-bold">0 mins (No balance)</span>';

    return `<tr class="hover:bg-slate-50 transition-colors">
      <td class="py-3 px-4 font-bold text-slate-800">${escapeHtml(r.country_name)}</td>
      <td class="py-3 px-4 font-mono font-bold text-[#1d68d8]">+${escapeHtml(r.country_code)}</td>
      <td class="py-3 px-4 font-mono font-black text-emerald-600">$${rate.toFixed(4)} / min</td>
      <td class="py-3 px-4 font-mono font-semibold text-slate-700">${talktimeText}</td>
      <td class="py-3 px-4 text-center">
        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">Active</span>
      </td>
      <td class="py-3 px-4 text-right">
        <button onclick="setCalcDestination('${r.country_code}')" class="px-2.5 py-1 rounded bg-slate-100 hover:bg-[#28b67a] hover:text-white text-slate-700 border border-slate-300 text-xs font-bold transition-colors">
          <i class="fa-solid fa-calculator mr-1"></i>Calculate
        </button>
      </td>
    </tr>`;
  }).join('');
}

function setCalcDestination(code) {
  const input = document.getElementById('calcDestinationInput');
  if (input) {
    input.value = '+' + code;
    calculateTalktime();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function filterRatesTable() {
  const query = (document.getElementById('ratesSearchInput')?.value || '').toLowerCase().trim();
  if (!query) return renderRatesTable(allRatesCache);

  const filtered = allRatesCache.filter(r => 
    (r.country_name || '').toLowerCase().includes(query) ||
    String(r.country_code || '').includes(query)
  );
  renderRatesTable(filtered);
}

function calculateTalktime() {
  const input = document.getElementById('calcDestinationInput');
  const dest = input ? input.value.replace(/[^0-9]/g, '') : '';
  const currentBal = parseFloat(currentUser?.balance || 0);

  const balEl = document.getElementById('calcCurrentBalance');
  if (balEl) balEl.textContent = `$${currentBal.toFixed(2)}`;

  let matched = null;
  if (dest && allRatesCache.length > 0) {
    let longestMatch = -1;
    for (const r of allRatesCache) {
      if (dest.startsWith(String(r.country_code)) && String(r.country_code).length > longestMatch) {
        longestMatch = String(r.country_code).length;
        matched = r;
      }
    }
  }

  if (!matched && allRatesCache.length > 0) {
    matched = allRatesCache.find(r => r.country_code === '0') || allRatesCache[0];
  }

  const destNameEl = document.getElementById('calcDestName');
  const rateEl = document.getElementById('calcRatePerMin');
  const talktimeEl = document.getElementById('calcEstTalktime');
  const alertEl = document.getElementById('calcStatusAlert');

  if (!matched) return;

  const rate = parseFloat(matched.rate_per_minute);
  const estMins = rate > 0 ? Math.floor(currentBal / rate) : 0;
  const estHrs = (estMins / 60).toFixed(1);

  if (destNameEl) destNameEl.textContent = `${matched.country_name} (+${matched.country_code})`;
  if (rateEl) rateEl.textContent = `$${rate.toFixed(4)} / min`;
  if (talktimeEl) talktimeEl.textContent = `${estMins} Minutes (~${estHrs} hrs)`;

  if (alertEl) {
    if (currentBal >= rate) {
      alertEl.className = 'mt-2 py-1 px-2.5 rounded text-center font-bold text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
      alertEl.innerHTML = `<i class="fa-solid fa-circle-check mr-1"></i> Call Allowed (Sufficient Talktime)`;
    } else {
      alertEl.className = 'mt-2 py-1 px-2.5 rounded text-center font-bold text-[11px] bg-rose-500/20 text-rose-300 border border-rose-500/30';
      alertEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1"></i> Insufficient Balance (Min $${rate.toFixed(4)} required)`;
    }
  }
}

// ============================================================================
// ADMIN CONSOLE: SUB-TABS & MULTI-SECTION MANAGEMENT
// ============================================================================
let currentAdminSubtab = 'users';

let c360PreviousSubtab = 'users';

function switchAdminSubtab(subtabId) {
  if (subtabId !== 'customer360') {
    c360PreviousSubtab = subtabId;
  }
  currentAdminSubtab = subtabId;
  const subtabs = ['users', 'requests', 'rates', 'dids', 'ledger', 'customer360'];

  // Keep adminMainHeader ALWAYS visible intact (Total Users, Active Extensions, Total System Balance, Numbers Allocated, Pending Top-ups)
  const adminHeader = document.getElementById('adminMainHeader');
  if (adminHeader) {
    adminHeader.classList.remove('hidden');
  }

  subtabs.forEach(s => {
    const el = document.getElementById(`adminSubtab-${s}`);
    const btn = document.getElementById(`adminSubtabBtn-${s}`);
    const sideBtn = document.getElementById(`sideNav-admin-${s}`);
    if (el) el.classList.toggle('hidden', s !== subtabId);
    if (btn) {
      if (s === subtabId) {
        btn.className = 'px-5 py-3 border-b-2 border-[#28b67a] text-slate-900 bg-slate-50 flex items-center gap-2 transition-colors';
      } else {
        btn.className = 'px-5 py-3 border-b-2 border-transparent text-slate-600 hover:text-slate-900 flex items-center gap-2 transition-colors';
      }
    }
    if (sideBtn) {
      if (s === subtabId || (subtabId === 'customer360' && s === c360PreviousSubtab)) {
        sideBtn.className = 'w-full text-left px-3 py-2 rounded bg-[#244853] text-white text-xs font-bold flex items-center space-x-2 border-l-4 border-[#8ae088] shadow-inner';
      } else {
        sideBtn.className = 'w-full text-left px-3 py-2 rounded bg-[#2f5b68] hover:bg-[#244853] text-xs font-semibold flex items-center space-x-2 transition-colors';
      }
    }
  });

  if (subtabId === 'users') fetchAdminUsers();
  if (subtabId === 'requests') fetchAdminBalanceRequests();
  if (subtabId === 'rates') fetchAdminRates();
  if (subtabId === 'dids') fetchAdminDids();
  if (subtabId === 'ledger') fetchAdminGlobalLedger();
}

// ----------------------------------------------------------------------------
// Admin Top-up Requests Management
// ----------------------------------------------------------------------------
let allAdminRequestsCache = [];

async function fetchAdminBalanceRequests() {
  if (!authToken) return;
  const tbody = document.getElementById('adminRequestsTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading requests...</td></tr>';
  }

  try {
    const res = await fetch('/api/admin/balance-requests', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    allAdminRequestsCache = data.requests || [];

    // Update all pending alerts and badges across the portal
    const pendingCount = allAdminRequestsCache.filter(r => r.status === 'pending').length;
    
    // 1. Subtab Requests Badge
    const badge = document.getElementById('adminPendingRequestsBadge');
    if (badge) {
      if (pendingCount > 0) {
        badge.textContent = pendingCount;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    // 2. Top Header Alert Pill
    const alertBtn = document.getElementById('adminPendingAlertBtn');
    const countEl = document.getElementById('adminPendingHeaderCount');
    if (alertBtn && countEl) {
      if (pendingCount > 0) {
        countEl.textContent = pendingCount;
        alertBtn.classList.remove('hidden');
      } else {
        alertBtn.classList.add('hidden');
      }
    }

    // 3. Header Nav Administration Tab Badge
    const navBadge = document.getElementById('adminNavBadge');
    if (navBadge) {
      if (pendingCount > 0) {
        navBadge.textContent = pendingCount;
        navBadge.classList.remove('hidden');
      } else {
        navBadge.classList.add('hidden');
      }
    }

    // 4. Main Dashboard / Dialer Banner
    const dashBanner = document.getElementById('adminTopupDashboardBanner');
    const bannerCount = document.getElementById('bannerPendingTopupCount');
    if (dashBanner && bannerCount) {
      if (pendingCount > 0) {
        bannerCount.textContent = pendingCount;
        dashBanner.classList.remove('hidden');
      } else {
        dashBanner.classList.add('hidden');
      }
    }

    // 5. Admin KPI Card
    const statPendingKpi = document.getElementById('adminStatPendingRequests');
    if (statPendingKpi) {
      statPendingKpi.textContent = pendingCount;
    }

    renderAdminRequestsTable();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-rose-500">${err.message}</td></tr>`;
  }
}

function filterAdminRequests() {
  renderAdminRequestsTable();
}

function renderAdminRequestsTable() {
  const tbody = document.getElementById('adminRequestsTableBody');
  if (!tbody) return;

  const filter = document.getElementById('adminReqFilterStatus')?.value || 'all';
  let list = allAdminRequestsCache;
  if (filter !== 'all') {
    list = list.filter(r => r.status === filter);
  }

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-slate-400">No top-up requests found</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(r => {
    let statusBadge = '';
    let actionButtons = '';

    if (r.status === 'pending') {
      statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">Pending Approval</span>';
      actionButtons = `
        <button onclick="approveBalanceRequest(${r.id}, ${parseFloat(r.amount)})" class="px-2.5 py-1 rounded bg-[#28b67a] hover:bg-[#229c67] text-white text-xs font-bold mr-1 shadow transition-colors">
          <i class="fa-solid fa-check mr-1"></i>Approve
        </button>
        <button onclick="rejectBalanceRequest(${r.id})" class="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow transition-colors">
          <i class="fa-solid fa-xmark mr-1"></i>Reject
        </button>
      `;
    } else if (r.status === 'approved') {
      statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300"><i class="fa-solid fa-circle-check mr-1"></i>Approved</span>';
      actionButtons = `<span class="text-slate-400 text-xs">Processed</span>`;
    } else {
      statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300"><i class="fa-solid fa-circle-xmark mr-1"></i>Rejected</span>';
      actionButtons = `<span class="text-slate-400 text-xs">Processed</span>`;
    }

    const d = new Date(r.created_at);
    const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userLine = `${escapeHtml(r.user_name || 'User')} <span class="text-slate-500 font-mono">(UID ${escapeHtml(r.order_id || '--')})</span>`;

    return `<tr>
      <td class="py-3 px-4 font-mono font-bold text-slate-700">#${r.id}</td>
      <td class="py-3 px-4 font-semibold text-slate-900">${userLine}</td>
      <td class="py-3 px-4 font-mono font-black text-emerald-600 text-sm">$${parseFloat(r.amount).toFixed(2)}</td>
      <td class="py-3 px-4 text-slate-700 font-medium">${escapeHtml(r.payment_method || 'Bank')}</td>
      <td class="py-3 px-4 font-mono text-slate-800 font-semibold">${escapeHtml(r.transaction_ref || '--')}</td>
      <td class="py-3 px-4 text-slate-500 max-w-xs truncate" title="${escapeHtml(r.notes || '')}">${escapeHtml(r.notes || '--')}</td>
      <td class="py-3 px-4 text-slate-500 text-xs">${dateStr}</td>
      <td class="py-3 px-4">${statusBadge}</td>
      <td class="py-3 px-4 text-right whitespace-nowrap">${actionButtons}</td>
    </tr>`;
  }).join('');
}

async function approveBalanceRequest(id, amount) {
  const note = prompt(`Approve balance request #${id} and credit $${amount.toFixed(2)} to customer? Optional note:`, 'Approved by Admin');
  if (note === null) return;

  try {
    const res = await fetch(`/api/admin/balance-requests/${id}/approve`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ admin_notes: note })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`Request #${id} approved! $${amount.toFixed(2)} credited to customer.`, 'success');
    fetchAdminBalanceRequests();
    fetchAdminUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function rejectBalanceRequest(id) {
  const reason = prompt(`Enter reason for rejecting request #${id}:`, 'Payment proof invalid or not received');
  if (reason === null) return;

  try {
    const res = await fetch(`/api/admin/balance-requests/${id}/reject`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ admin_notes: reason })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`Request #${id} rejected.`, 'info');
    fetchAdminBalanceRequests();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------------------------------
// Admin Destination Rates Management
// ----------------------------------------------------------------------------
async function fetchAdminRates() {
  if (!authToken) return;
  const tbody = document.getElementById('adminRatesTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading rates...</td></tr>';
  }

  try {
    const res = await fetch('/api/admin/rates', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const rates = data.rates || [];
    if (rates.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-slate-400">No rates configured</td></tr>';
      return;
    }

    tbody.innerHTML = rates.map(r => `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="py-3 px-4 font-bold text-slate-800">${escapeHtml(r.country_name)}</td>
        <td class="py-3 px-4 font-mono font-bold text-[#1d68d8]">+${escapeHtml(r.country_code)}</td>
        <td class="py-3 px-4 font-mono font-bold text-emerald-600">$${parseFloat(r.rate_per_minute).toFixed(4)} / min</td>
        <td class="py-3 px-4 text-center">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">Active</span>
        </td>
        <td class="py-3 px-4 text-right">
          <button onclick="editAdminRate('${escapeHtml(r.country_name)}', '${escapeHtml(r.country_code)}', ${parseFloat(r.rate_per_minute)})" class="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold mr-1 transition-colors">
            <i class="fa-solid fa-pen mr-1"></i>Edit
          </button>
          <button onclick="deleteAdminRate(${r.id}, '${escapeHtml(r.country_name)}')" class="px-2.5 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold transition-colors">
            <i class="fa-solid fa-trash mr-1"></i>Delete
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-rose-500">${err.message}</td></tr>`;
  }
}

function editAdminRate(country, code, rate) {
  document.getElementById('adminRateCountryName').value = country;
  document.getElementById('adminRateCountryCode').value = code;
  document.getElementById('adminRatePerMin').value = rate;
  document.getElementById('adminRateCountryName').focus();
}

async function handleSaveAdminRate(e) {
  e.preventDefault();
  const country_name = document.getElementById('adminRateCountryName').value.trim();
  const country_code = document.getElementById('adminRateCountryCode').value.trim();
  const rate_per_minute = parseFloat(document.getElementById('adminRatePerMin').value);

  if (!country_name || !country_code || isNaN(rate_per_minute) || rate_per_minute <= 0) {
    showToast('Please enter valid country name, code, and rate per minute', 'error');
    return;
  }

  try {
    const res = await fetch('/api/admin/rates', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ country_name, country_code, rate_per_minute })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`Rate for ${country_name} (${country_code}) saved successfully!`, 'success');
    document.getElementById('adminRateCountryName').value = '';
    document.getElementById('adminRateCountryCode').value = '';
    document.getElementById('adminRatePerMin').value = '';
    fetchAdminRates();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteAdminRate(id, name) {
  if (!confirm(`Are you sure you want to delete rate for ${name}?`)) return;
  try {
    const res = await fetch(`/api/admin/rates/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Rate deleted', 'success');
    fetchAdminRates();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------------------------------
// Admin DID Inventory Management
// ----------------------------------------------------------------------------
let allAdminDidsCache = [];

async function fetchAdminDids() {
  if (!authToken) return;
  const tbody = document.getElementById('adminDidsTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading inventory...</td></tr>';
  }

  try {
    const res = await fetch('/api/admin/dids', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    allAdminDidsCache = data.dids || [];
    renderAdminDidsTable();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-rose-500">${err.message}</td></tr>`;
  }
}

function filterAdminDids() {
  renderAdminDidsTable();
}

function renderAdminDidsTable() {
  const tbody = document.getElementById('adminDidsTableBody');
  if (!tbody) return;

  const filter = document.getElementById('adminDidFilterStatus')?.value || 'all';
  const searchTerm = (document.getElementById('adminDidSearchInput')?.value || '').trim().toLowerCase();

  let list = allAdminDidsCache;
  if (filter !== 'all') {
    list = list.filter(d => d.status === filter);
  }

  if (searchTerm) {
    list = list.filter(d => {
      const num = String(d.did_number || '').toLowerCase();
      const country = String(d.country || '').toLowerCase();
      const owner = String(d.owner_name || '').toLowerCase();
      const email = String(d.owner_email || '').toLowerCase();
      const ext = String(d.owner_ext || '').toLowerCase();
      const dest = String(d.forward_destination || '').toLowerCase();
      return num.includes(searchTerm) || 
             country.includes(searchTerm) || 
             owner.includes(searchTerm) || 
             email.includes(searchTerm) || 
             ext.includes(searchTerm) || 
             dest.includes(searchTerm);
    });
  }

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-400">No matching DID numbers found</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(d => {
    let statusBadge = '';
    let actionButtons = '';
    let customerInfo = '<span class="text-slate-400 font-sans italic">Unassigned</span>';
    let forwardInfo = '<span class="text-slate-400 font-sans">--</span>';

    if (d.status === 'available') {
      statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">Available in Store</span>';
      actionButtons = `
        <div class="flex items-center justify-end gap-1.5">
          <button onclick="openAdminAssignDidModal(${d.id}, '${escapeHtml(d.did_number)}', '${escapeHtml(d.country)}')" class="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1 shadow-sm transition-colors" title="Directly assign this number to a customer">
            <i class="fa-solid fa-user-plus"></i>
            <span>Assign to User</span>
          </button>
          <button onclick="deleteAdminDid(${d.id}, '${escapeHtml(d.did_number)}')" class="px-2 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs transition-colors" title="Delete DID from inventory">
            <i class="fa-solid fa-trash mr-1"></i>Delete
          </button>
        </div>
      `;
    } else {
      statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-300">Allocated / Active</span>';
      
      customerInfo = `
        <div class="flex items-center gap-1.5">
          <a href="#" onclick="openCustomer360Modal(${d.user_id}); return false;" class="font-bold text-slate-900 hover:text-[#1d68d8] hover:underline flex items-center gap-1">
            <i class="fa-solid fa-user-circle text-slate-400 text-xs"></i>
            <span>${escapeHtml(d.owner_name || 'Customer')}</span>
          </a>
          <span class="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 font-mono font-bold text-[10px]" title="Current Balance">
            $${parseFloat(d.owner_balance || 0).toFixed(2)}
          </span>
        </div>
        <div class="text-[10px] text-slate-500 font-mono mt-0.5 flex items-center gap-2">
          <span>UID <strong class="text-blue-700 font-bold">${escapeHtml(d.owner_ext || '--')}</strong></span>
          <span>?</span>
          <span class="truncate max-w-[150px]">${escapeHtml(d.owner_email || '')}</span>
        </div>
      `;

      const vmBadge = d.voicemail_enabled 
        ? `<span class="text-emerald-700 font-semibold text-[10px] flex items-center gap-1"><i class="fa-solid fa-voicemail text-emerald-600"></i>VM: ${d.voicemail_timeout || 20}s</span>` 
        : '<span class="text-slate-400 text-[10px]"><i class="fa-solid fa-voicemail mr-1"></i>VM: Off</span>';

      forwardInfo = `
        <div>
          <span class="font-mono text-xs font-bold text-[#1d68d8] bg-blue-50 px-2 py-0.5 rounded border border-blue-200 inline-block">
            ${escapeHtml(d.forward_type || 'SIP_URI')}: ${escapeHtml(d.forward_destination || 'UID ' + (d.owner_ext || ''))}
          </span>
          <div class="mt-1">${vmBadge}</div>
        </div>
      `;

      actionButtons = `
        <div class="flex items-center justify-end gap-1.5">
          <button onclick="openCustomer360Modal(${d.user_id})" class="px-2 py-1 rounded bg-[#1d68d8] hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1 shadow-sm transition-colors" title="View Customer 360? Profile & Financial Ledger">
            <i class="fa-solid fa-address-card"></i>
            <span>Customer 360?</span>
          </button>
          <button onclick="openAdminEditRoutingModal(${d.id}, '${escapeHtml(d.did_number)}', '${escapeHtml(d.forward_type || 'SIP_URI')}', '${escapeHtml(d.forward_destination || '')}', ${d.voicemail_enabled ? 1 : 0}, ${d.voicemail_timeout || 20})" class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 font-bold text-xs flex items-center gap-1 transition-colors" title="Change Forwarding Destination or Voicemail">
            <i class="fa-solid fa-route text-indigo-600"></i>
            <span>Route</span>
          </button>
          <button onclick="releaseAdminDid(${d.id}, '${escapeHtml(d.did_number)}')" class="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 font-bold text-xs flex items-center gap-1 transition-colors" title="Release back to store">
            <i class="fa-solid fa-arrow-rotate-left"></i>
            <span>Release</span>
          </button>
        </div>
      `;
    }

    return `<tr class="hover:bg-slate-50 transition-colors">
      <td class="py-3 px-4 font-mono font-bold text-slate-900">${escapeHtml(d.did_number)}</td>
      <td class="py-3 px-4 text-slate-700 font-medium">${escapeHtml(d.country)}</td>
      <td class="py-3 px-4 font-mono font-bold text-emerald-600">$${parseFloat(d.monthly_cost).toFixed(2)}/mo</td>
      <td class="py-3 px-4">${statusBadge}</td>
      <td class="py-3 px-4">${customerInfo}</td>
      <td class="py-3 px-4">${forwardInfo}</td>
      <td class="py-3 px-4 text-right whitespace-nowrap">${actionButtons}</td>
    </tr>`;
  }).join('');
}

function openModalAddDidInventory() {
  const modal = document.getElementById('modalAddDidInventory');
  if (modal) modal.classList.remove('hidden');
}

function closeModalAddDidInventory() {
  const modal = document.getElementById('modalAddDidInventory');
  if (modal) modal.classList.add('hidden');
}

async function handleAddAdminDids(e) {
  e.preventDefault();
  const country = document.getElementById('adminDidCountry').value.trim();
  const monthly_cost = parseFloat(document.getElementById('adminDidMonthlyCost').value);
  const rawNumbers = document.getElementById('adminDidNumbers').value.trim();

  if (!country || !rawNumbers) {
    showToast('Please fill in country and DID numbers', 'error');
    return;
  }

  try {
    const res = await fetch('/api/admin/dids', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ numbers: rawNumbers, country, monthly_cost })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(data.message || 'DID numbers added to inventory!', 'success');
    document.getElementById('adminDidNumbers').value = '';
    closeModalAddDidInventory();
    fetchAdminDids();
    if (currentTab === 'marketplace') fetchAvailableDids();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteAdminDid(id, number) {
  if (!confirm(`Delete number ${number} from inventory?`)) return;
  try {
    const res = await fetch(`/api/admin/dids/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Number deleted from inventory', 'success');
    fetchAdminDids();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function releaseAdminDid(id, number) {
  if (!confirm(`Release number ${number} back to available marketplace inventory? The current customer will lose this number.`)) return;
  try {
    const res = await fetch(`/api/admin/dids/${id}/release`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Number released back to available inventory', 'success');
    fetchAdminDids();
    if (currentAdminSubtab === 'customer360' && currentC360UserId) {
      await openCustomer360Modal(currentC360UserId, 'dids');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function checkAdminPendingRequests() {
  if (!authToken || !currentUser) return;
  const isAdmin = Boolean(currentUser.is_admin === 1 || currentUser.is_admin === true || currentUser.role === 'admin');
  if (!isAdmin) {
    const alertBtn = document.getElementById('adminPendingAlertBtn');
    if (alertBtn) alertBtn.classList.add('hidden');
    const navBadge = document.getElementById('adminNavBadge');
    if (navBadge) navBadge.classList.add('hidden');
    const dashBanner = document.getElementById('adminTopupDashboardBanner');
    if (dashBanner) dashBanner.classList.add('hidden');
    return;
  }
  await fetchAdminBalanceRequests();
}

// Active background poller for Voicemail & Admin Top-up Alerts (every 8 seconds)
setInterval(() => {
  if (authToken) {
    updateVoicemailBadge();
    checkAdminPendingRequests();
  }
}, 8000);


// ============================================================================
// CUSTOMER 360? PROFILE & FINANCIAL LEDGER
// ============================================================================
let currentC360Data = null;
let currentC360UserId = null;
let c360SecretVisible = false;

let currentC360Tab = 'overview';

async function openCustomer360Modal(userId, initialTab = 'overview') {
  if (!authToken || !userId) return;
  currentC360UserId = userId;
  c360SecretVisible = false;

  // Record originating subtab if not currently on customer360
  if (currentAdminSubtab && currentAdminSubtab !== 'customer360') {
    c360PreviousSubtab = currentAdminSubtab;
  }

  // Update Back button text based on previous subtab
  const backBtnText = document.getElementById('c360BackBtnText');
  if (backBtnText) {
    const labels = {
      'users': 'Customers & UIDs',
      'requests': 'Top-up Requests',
      'rates': 'Destination Rates',
      'dids': 'DID Numbers & Routing',
      'ledger': 'Financial Statements / Ledger'
    };
    backBtnText.textContent = `Back to ${labels[c360PreviousSubtab] || 'Previous View'}`;
  }

  // Switch to admin tab and customer360 subtab inline on the same page
  switchTab('admin');
  switchAdminSubtab('customer360');

  // Reset eye icon
  const eye = document.getElementById('c360SecretEye');
  if (eye) eye.className = 'fa-solid fa-eye-slash text-xs';

  // Set loading placeholders
  const nameEl = document.getElementById('c360Name');
  if (nameEl) nameEl.textContent = 'Loading profile...';
  const emailEl = document.getElementById('c360Email');
  if (emailEl) emailEl.textContent = '...';
  const extEl = document.getElementById('c360Ext');
  if (extEl) extEl.textContent = '--';
  const balEl = document.getElementById('c360Balance');
  if (balEl) balEl.textContent = '$--';
  const topBadge = document.getElementById('c360TopHeaderBadge');
  if (topBadge) topBadge.textContent = 'Loading...';

  // Ensure top KPI cards are populated
  if (!adminUsersList || adminUsersList.length === 0) {
    fetchAdminUsers();
  }

  // Smooth scroll so the 5 KPI cards remain visible and user information opens directly underneath
  const subtab360 = document.getElementById('adminSubtab-customer360');
  if (subtab360) {
    subtab360.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  try {
    const res = await fetch(`/api/admin/users/${userId}/profile`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch customer profile');

    currentC360Data = data;
    renderCustomer360Data(data);
    switchC360Tab(initialTab || currentC360Tab || 'overview');
  } catch (err) {
    showToast(err.message, 'error');
    closeCustomer360Modal();
  }
}

function closeCustomer360Modal() {
  currentC360Data = null;
  currentC360UserId = null;
  switchAdminSubtab(c360PreviousSubtab || 'users');
}

function switchC360Tab(tabId) {
  currentC360Tab = tabId;
  const tabs = ['overview', 'ledger', 'dids', 'cdrs', 'voicemails'];
  tabs.forEach(t => {
    const content = document.getElementById(`c360TabContent-${t}`);
    const btn = document.getElementById(`c360TabBtn-${t}`);
    if (content) content.classList.toggle('hidden', t !== tabId);
    if (btn) {
      if (t === tabId) {
        btn.className = 'px-4 py-2 border-b-2 border-[#28b67a] text-slate-900 bg-white rounded-t flex items-center gap-1.5 transition-colors';
      } else {
        btn.className = 'px-4 py-2 border-b-2 border-transparent text-slate-600 hover:text-slate-900 flex items-center gap-1.5 transition-colors';
      }
    }
  });
}

function renderCustomer360Data(data) {
  const u = data.user;
  const f = data.financials;

  // 1. Header Badges
  const topBadge = document.getElementById('c360TopHeaderBadge');
  if (topBadge) topBadge.textContent = `UID ${u.sip_extension || '--'} (${u.name || 'User'})`;
  document.getElementById('c360Name').textContent = u.name;
  document.getElementById('c360Email').textContent = u.email;
  document.getElementById('c360Ext').textContent = u.sip_extension;
  document.getElementById('c360Balance').textContent = `$${parseFloat(u.balance || 0).toFixed(2)}`;

  const roleBadge = document.getElementById('c360RoleBadge');
  if (roleBadge) {
    roleBadge.textContent = u.is_admin ? 'Admin' : 'User';
    roleBadge.className = u.is_admin 
      ? 'px-2 py-0.2 rounded text-[9px] font-black uppercase bg-purple-200 text-purple-900' 
      : 'px-2 py-0.2 rounded text-[9px] font-black uppercase bg-slate-200 text-slate-700';
  }

  const statusBadge = document.getElementById('c360StatusBadge');
  if (statusBadge) {
    statusBadge.textContent = u.sip_status === 'active' ? 'Active' : 'Suspended';
    statusBadge.className = u.sip_status === 'active'
      ? 'px-2 py-0.2 rounded text-[9px] font-black uppercase bg-emerald-200 text-emerald-900'
      : 'px-2 py-0.2 rounded text-[9px] font-black uppercase bg-rose-200 text-rose-900';
  }

  // 2. Tab 1: Profile & SIP Credentials
  document.getElementById('c360SipExtBadge').textContent = u.sip_extension;
  document.getElementById('c360SipSecret').textContent = '????????';
  document.getElementById('c360RegisteredDate').textContent = u.created_at ? new Date(u.created_at).toLocaleDateString() : '--';
  const phoneEl = document.getElementById('c360Phone');
  const addrEl = document.getElementById('c360Address');
  if (phoneEl) phoneEl.textContent = u.phone || 'Not Provided';
  if (addrEl) addrEl.textContent = u.address || 'Not Provided';
  document.getElementById('c360SipStateBadge').textContent = u.sip_status.toUpperCase();
  document.getElementById('c360CurrentBalWidget').textContent = `$${parseFloat(u.balance || 0).toFixed(2)}`;

  // 3. Tab 2: Financial Ledger Statement & KPIs
  document.getElementById('c360StatCredits').textContent = `+$${parseFloat(f.total_topup || 0).toFixed(2)}`;
  document.getElementById('c360StatCalls').textContent = `-$${parseFloat(f.total_call_cost || 0).toFixed(2)}`;
  document.getElementById('c360StatDids').textContent = `-$${parseFloat(f.total_did_cost || 0).toFixed(2)}`;
  document.getElementById('c360StatBalance').textContent = `$${parseFloat(f.current_balance || 0).toFixed(2)}`;

  renderCustomerLedgerTable(data.ledger || []);

  // 4. Tab 3: Allocated DIDs
  document.getElementById('c360DidsCount').textContent = (data.dids || []).length;
  renderCustomerDidsTable(data.dids || []);

  // 5. Tab 4: Call Logs (CDRs)
  document.getElementById('c360CdrsCount').textContent = (data.cdrs || []).length;
  renderCustomerCdrsTable(data.cdrs || []);

  // 6. Tab 5: Voicemails
  document.getElementById('c360VmCount').textContent = (data.voicemails || []).length;
  renderCustomerVmTable(data.voicemails || []);
}

function toggleC360SecretVisibility() {
  if (!currentC360Data || !currentC360Data.user) return;
  c360SecretVisible = !c360SecretVisible;
  const label = document.getElementById('c360SipSecret');
  const eye = document.getElementById('c360SecretEye');
  if (c360SecretVisible) {
    label.textContent = currentC360Data.user.sip_password || '--';
    eye.className = 'fa-solid fa-eye text-xs text-[#28b67a]';
  } else {
    label.textContent = '????????';
    eye.className = 'fa-solid fa-eye-slash text-xs';
  }
}

function openEditUserFrom360() {
  if (!currentC360UserId) return;
  openEditUserModal(currentC360UserId);
}

function renderCustomerLedgerTable(ledger) {
  const tbody = document.getElementById('c360LedgerTableBody');
  if (!tbody) return;

  if (ledger.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-slate-400 font-sans">No financial transactions recorded yet</td></tr>';
    return;
  }

  tbody.innerHTML = ledger.map(item => {
    let typeBadge = '';
    let amountDisplay = '';

    if (item.type === 'TOPUP_CREDIT') {
      typeBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">Top-up Credit</span>';
      amountDisplay = `<span class="text-emerald-700 font-bold">+$${parseFloat(item.amount).toFixed(2)}</span>`;
    } else if (item.type === 'CALL_DEBIT') {
      typeBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">Call Charge</span>';
      amountDisplay = `<span class="text-rose-700 font-bold">-$${parseFloat(item.amount).toFixed(4)}</span>`;
    } else if (item.type === 'DID_PURCHASE') {
      typeBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-300">DID Allocation</span>';
      amountDisplay = `<span class="text-indigo-700 font-bold">-$${parseFloat(item.amount).toFixed(2)}</span>`;
    } else {
      typeBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">Adjustment</span>';
      const isPos = parseFloat(item.balance_after) >= parseFloat(item.balance_before);
      amountDisplay = `<span class="${isPos ? 'text-emerald-700' : 'text-rose-700'} font-bold">${isPos ? '+' : '-'}$${parseFloat(item.amount).toFixed(2)}</span>`;
    }

    const dt = item.created_at ? new Date(item.created_at).toLocaleString() : '--';
    const refText = item.reference_id ? `#${item.reference_id}` : '--';
    const balAfter = item.balance_after !== null && item.balance_after !== undefined ? `$${parseFloat(item.balance_after).toFixed(2)}` : '--';

    return `<tr class="hover:bg-slate-50 transition-colors">
      <td class="py-2.5 px-3 whitespace-nowrap text-slate-600">${dt}</td>
      <td class="py-2.5 px-3 font-sans">${typeBadge}</td>
      <td class="py-2.5 px-3 font-sans text-slate-800 font-medium">${escapeHtml(item.description)}</td>
      <td class="py-2.5 px-3 text-slate-500">${escapeHtml(refText)}</td>
      <td class="py-2.5 px-3 text-right">${amountDisplay}</td>
      <td class="py-2.5 px-3 text-right font-bold text-slate-900">${balAfter}</td>
    </tr>`;
  }).join('');
}

function renderCustomerDidsTable(dids) {
  const tbody = document.getElementById('c360DidsTableBody');
  if (!tbody) return;

  if (dids.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-slate-400 font-sans">No DIDs currently allocated to this customer</td></tr>';
    return;
  }

  tbody.innerHTML = dids.map(d => {
    const vmText = d.voicemail_enabled 
      ? `<span class="text-emerald-700 font-semibold text-[10px]"><i class="fa-solid fa-voicemail mr-1"></i>VM: ${d.voicemail_timeout || 20}s</span>` 
      : '<span class="text-slate-400 text-[10px]"><i class="fa-solid fa-voicemail mr-1"></i>Off</span>';

    return `<tr class="hover:bg-slate-50 transition-colors">
      <td class="py-2.5 px-3 font-mono font-bold text-[#1d68d8]">${escapeHtml(d.did_number)}</td>
      <td class="py-2.5 px-3 text-slate-700">${escapeHtml(d.country)}</td>
      <td class="py-2.5 px-3 font-mono font-bold text-emerald-600">$${parseFloat(d.monthly_cost).toFixed(2)}</td>
      <td class="py-2.5 px-3 font-mono text-slate-800">
        <span class="bg-blue-50 px-2 py-0.5 rounded border border-blue-200">${escapeHtml(d.forward_type)}: ${escapeHtml(d.forward_destination)}</span>
      </td>
      <td class="py-2.5 px-3">${vmText}</td>
      <td class="py-2.5 px-3 text-right whitespace-nowrap">
        <button onclick="openAdminEditRoutingModal(${d.did_id}, '${escapeHtml(d.did_number)}', '${escapeHtml(d.forward_type)}', '${escapeHtml(d.forward_destination)}', ${d.voicemail_enabled ? 1 : 0}, ${d.voicemail_timeout || 20})" class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 font-bold text-xs mr-1">
          <i class="fa-solid fa-route text-indigo-600 mr-1"></i>Route
        </button>
        <button onclick="releaseAdminDid(${d.did_id}, '${escapeHtml(d.did_number)}')" class="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 font-bold text-xs">
          Release
        </button>
      </td>
    </tr>`;
  }).join('');
}

function renderCustomerCdrsTable(cdrs) {
  const tbody = document.getElementById('c360CdrsTableBody');
  if (!tbody) return;

  if (cdrs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-slate-400 font-sans">No call records found for this account</td></tr>';
    return;
  }

  tbody.innerHTML = cdrs.map(c => {
    const isAnswered = c.disposition === 'ANSWERED';
    const dispBadge = isAnswered 
      ? '<span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-sans font-bold text-[10px]">ANSWERED</span>' 
      : `<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-sans font-bold text-[10px]">${escapeHtml(c.disposition)}</span>`;

    const dt = c.created_at ? new Date(c.created_at).toLocaleString() : '--';
    const durMins = (c.duration / 60).toFixed(1);

    return `<tr class="hover:bg-slate-50 transition-colors">
      <td class="py-2 px-3 text-slate-600 whitespace-nowrap">${dt}</td>
      <td class="py-2 px-3 font-bold text-slate-800">${escapeHtml(c.caller)}</td>
      <td class="py-2 px-3 font-bold text-[#1d68d8]">${escapeHtml(c.callee)}</td>
      <td class="py-2 px-3 text-slate-700">${c.duration}s (${durMins}m)</td>
      <td class="py-2 px-3">${dispBadge}</td>
      <td class="py-2 px-3 text-right font-bold text-slate-900">$${parseFloat(c.cost || 0).toFixed(4)}</td>
    </tr>`;
  }).join('');
}

function renderCustomerVmTable(vms) {
  const tbody = document.getElementById('c360VmTableBody');
  if (!tbody) return;

  if (vms.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-slate-400 font-sans">No voicemails left for this customer yet</td></tr>';
    return;
  }

  tbody.innerHTML = vms.map(vm => {
    const dt = vm.created_at ? new Date(vm.created_at).toLocaleString() : '--';
    return `<tr class="hover:bg-slate-50 transition-colors">
      <td class="py-2 px-3 font-mono text-slate-600">${dt}</td>
      <td class="py-2 px-3 font-mono font-bold text-[#1d68d8]">${escapeHtml(vm.did_number)}</td>
      <td class="py-2 px-3 font-mono text-slate-800">${escapeHtml(vm.caller_id || 'Anonymous')}</td>
      <td class="py-2 px-3 font-mono text-slate-600">${vm.duration}s</td>
      <td class="py-2 px-3">
        <audio controls src="${escapeHtml(vm.file_path)}" class="h-7 w-48"></audio>
      </td>
    </tr>`;
  }).join('');
}

async function handleC360AdjustBalance(e) {
  e.preventDefault();
  if (!currentC360UserId) return;

  const btn = document.getElementById('btnC360AdjustSubmit');
  const typeRadios = document.getElementsByName('c360AdjustType');
  let selectedType = 'credit';
  for (let r of typeRadios) {
    if (r.checked) { selectedType = r.value; break; }
  }

  const rawAmount = parseFloat(document.getElementById('c360AdjustAmount').value);
  const reason = document.getElementById('c360AdjustReason').value.trim();

  if (isNaN(rawAmount) || rawAmount <= 0) {
    showToast('Please enter a valid positive adjustment amount', 'error');
    return;
  }
  if (!reason) {
    showToast('Please enter an audit reason / description', 'error');
    return;
  }

  const delta = (selectedType === 'debit') ? -rawAmount : rawAmount;

  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`/api/admin/users/${currentC360UserId}/balance`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        type: 'adjust',
        amount: delta,
        reason: reason
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`Balance adjusted successfully! New Balance: $${parseFloat(data.new_balance).toFixed(2)}`, 'success');
    document.getElementById('c360AdjustAmount').value = '';
    document.getElementById('c360AdjustReason').value = '';

    // Reload profile
    await openCustomer360Modal(currentC360UserId);
    fetchAdminUsers();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function printCustomerLedger() {
  if (!currentC360Data) return;
  const printWindow = window.open('', '_blank');
  const u = currentC360Data.user;
  const f = currentC360Data.financials;
  const ledger = currentC360Data.ledger || [];

  const rowsHtml = ledger.map(item => `
    <tr>
      <td style="padding:6px;border-bottom:1px solid #ddd;">${new Date(item.created_at).toLocaleString()}</td>
      <td style="padding:6px;border-bottom:1px solid #ddd;">${escapeHtml(item.type)}</td>
      <td style="padding:6px;border-bottom:1px solid #ddd;">${escapeHtml(item.description)}</td>
      <td style="padding:6px;border-bottom:1px solid #ddd;">${item.reference_id ? '#' + item.reference_id : '--'}</td>
      <td style="padding:6px;border-bottom:1px solid #ddd;text-align:right;">$${parseFloat(item.amount).toFixed(4)}</td>
      <td style="padding:6px;border-bottom:1px solid #ddd;text-align:right;font-weight:bold;">$${parseFloat(item.balance_after || 0).toFixed(2)}</td>
    </tr>
  `).join('');

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Statement of Account - ${escapeHtml(u.name)}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 20px; font-size: 12px; }
        h1, h2 { margin: 0 0 5px 0; }
        .kpi { display: inline-block; padding: 10px; margin-right: 15px; border: 1px solid #ccc; border-radius: 4px; min-width: 140px; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        th { background: #3b5a69; color: white; padding: 8px; text-align: left; }
      </style>
    </head>
    <body>
      <h2>SipMyNumber / VPL Telecom Statement</h2>
      <p><strong>Customer:</strong> ${escapeHtml(u.name)} (${escapeHtml(u.email)}) | <strong>UID:</strong> ${escapeHtml(u.sip_extension)}</p>
      <div style="margin: 15px 0;">
        <div class="kpi">Total Deposits: <strong>+$${f.total_topup.toFixed(2)}</strong></div>
        <div class="kpi">Call Charges: <strong>-$${f.total_call_cost.toFixed(2)}</strong></div>
        <div class="kpi">DID Fees: <strong>-$${f.total_did_cost.toFixed(2)}</strong></div>
        <div class="kpi" style="background:#e6f4ea;">Current Balance: <strong>$${f.current_balance.toFixed(2)}</strong></div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Date & Time</th>
            <th>Type</th>
            <th>Description</th>
            <th>Ref #</th>
            <th style="text-align:right;">Amount</th>
            <th style="text-align:right;">Balance After</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
      <script>window.print();</script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

// ============================================================================
// ADMIN DID ROUTING & ASSIGNMENT MODALS
// ============================================================================
function openAdminEditRoutingModal(didId, number, forwardType, forwardDest, vmEnabled, vmTimeout) {
  document.getElementById('adminRoutingDidId').value = didId;
  document.getElementById('adminRoutingDidNumberBadge').textContent = number;
  document.getElementById('adminRoutingForwardType').value = forwardType || 'SIP_URI';
  document.getElementById('adminRoutingForwardDest').value = forwardDest || '';
  document.getElementById('adminRoutingVoicemail').checked = Boolean(vmEnabled);
  document.getElementById('adminRoutingVmTimeout').value = vmTimeout || 20;

  const modal = document.getElementById('modalAdminEditRouting');
  if (modal) modal.classList.remove('hidden');
}

function closeAdminEditRoutingModal() {
  const modal = document.getElementById('modalAdminEditRouting');
  if (modal) modal.classList.add('hidden');
}

async function handleAdminSubmitRouting(e) {
  e.preventDefault();
  const didId = document.getElementById('adminRoutingDidId').value;
  const forward_type = document.getElementById('adminRoutingForwardType').value;
  const forward_destination = document.getElementById('adminRoutingForwardDest').value.trim();
  const voicemail_enabled = document.getElementById('adminRoutingVoicemail').checked ? 1 : 0;
  const voicemail_timeout = parseInt(document.getElementById('adminRoutingVmTimeout').value, 10);

  const btn = document.getElementById('btnAdminRoutingSubmit');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`/api/admin/dids/${didId}/routing`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ forward_type, forward_destination, voicemail_enabled, voicemail_timeout })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('DID routing and voicemail updated & synced with Asterisk!', 'success');
    closeAdminEditRoutingModal();
    fetchAdminDids();
    if (currentAdminSubtab === 'customer360' && currentC360UserId) {
      await openCustomer360Modal(currentC360UserId, 'dids');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openAdminAssignDidModal(didId, number, country) {
  document.getElementById('adminAssignDidId').value = didId;
  document.getElementById('adminAssignDidNumber').textContent = number;
  document.getElementById('adminAssignDidCountry').textContent = country || '';

  const select = document.getElementById('adminAssignDidUserSelect');
  if (select) {
    select.innerHTML = '<option value="">-- Choose Customer --</option>' + 
      adminUsersList.map(u => `<option value="${u.id}">${escapeHtml(u.name)} (UID ${u.order_id || '--'} • ${escapeHtml(u.email)})</option>`).join('');
  }

  const modal = document.getElementById('modalAdminAssignDid');
  if (modal) modal.classList.remove('hidden');
}

function closeAdminAssignDidModal() {
  const modal = document.getElementById('modalAdminAssignDid');
  if (modal) modal.classList.add('hidden');
}

async function handleAdminSubmitAssignDid(e) {
  e.preventDefault();
  const didId = document.getElementById('adminAssignDidId').value;
  const user_id = document.getElementById('adminAssignDidUserSelect').value;

  if (!user_id) {
    showToast('Please select a customer to assign this DID', 'error');
    return;
  }

  const btn = document.getElementById('btnAdminAssignSubmit');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`/api/admin/dids/${didId}/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ user_id })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(data.message || 'DID assigned successfully!', 'success');
    closeAdminAssignDidModal();
    fetchAdminDids();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ============================================================================
// ADMIN GLOBAL FINANCIAL STATEMENTS & AUDIT LEDGER
// ============================================================================
let allAdminGlobalLedgerCache = [];

async function fetchAdminGlobalLedger() {
  if (!authToken) return;
  const tbody = document.getElementById('adminGlobalLedgerTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-400 font-sans"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading financial ledger...</td></tr>';
  }

  try {
    const res = await fetch('/api/admin/ledger?limit=300', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch financial ledger');

    allAdminGlobalLedgerCache = data.ledger || [];
    renderAdminGlobalLedgerTable();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-rose-500 font-sans">${err.message}</td></tr>`;
  }
}

function filterAdminGlobalLedger() {
  renderAdminGlobalLedgerTable();
}

function renderAdminGlobalLedgerTable() {
  const tbody = document.getElementById('adminGlobalLedgerTableBody');
  if (!tbody) return;

  const typeFilter = document.getElementById('adminLedgerFilterType')?.value || 'all';
  const searchTerm = (document.getElementById('adminLedgerSearchInput')?.value || '').trim().toLowerCase();

  let list = allAdminGlobalLedgerCache;
  if (typeFilter !== 'all') {
    list = list.filter(item => item.type === typeFilter);
  }

  if (searchTerm) {
    list = list.filter(item => {
      const name = String(item.user_name || '').toLowerCase();
      const email = String(item.user_email || '').toLowerCase();
      const ext = String(item.user_ext || '').toLowerCase();
      const desc = String(item.description || '').toLowerCase();
      return name.includes(searchTerm) || email.includes(searchTerm) || ext.includes(searchTerm) || desc.includes(searchTerm);
    });
  }

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-400 font-sans">No ledger entries match the selected filters</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(item => {
    let typeBadge = '';
    let amountDisplay = '';

    if (item.type === 'TOPUP_CREDIT') {
      typeBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">Top-up Credit</span>';
      amountDisplay = `<span class="text-emerald-700 font-bold">+$${parseFloat(item.amount).toFixed(2)}</span>`;
    } else if (item.type === 'CALL_DEBIT') {
      typeBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">Call Charge</span>';
      amountDisplay = `<span class="text-rose-700 font-bold">-$${parseFloat(item.amount).toFixed(4)}</span>`;
    } else if (item.type === 'DID_PURCHASE') {
      typeBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-300">DID Allocation</span>';
      amountDisplay = `<span class="text-indigo-700 font-bold">-$${parseFloat(item.amount).toFixed(2)}</span>`;
    } else {
      typeBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">Adjustment</span>';
      const isPos = parseFloat(item.balance_after) >= parseFloat(item.balance_before);
      amountDisplay = `<span class="${isPos ? 'text-emerald-700' : 'text-rose-700'} font-bold">${isPos ? '+' : '-'}$${parseFloat(item.amount).toFixed(2)}</span>`;
    }

    const dt = item.created_at ? new Date(item.created_at).toLocaleString() : '--';
    const customerInfo = `
      <div class="font-bold text-slate-900 font-sans">
        <a href="#" onclick="openCustomer360Modal(${item.user_id}); return false;" class="hover:text-[#1d68d8] hover:underline">${escapeHtml(item.user_name || 'Customer')}</a>
      </div>
      <div class="text-[10px] text-slate-500 font-mono">UID ${escapeHtml(item.user_ext || '--')} • ${escapeHtml(item.user_email || '')}</div>
    `;

    const balAfter = item.balance_after !== null && item.balance_after !== undefined ? `$${parseFloat(item.balance_after).toFixed(2)}` : '--';

    return `<tr class="hover:bg-slate-50 transition-colors">
      <td class="py-2.5 px-4 text-slate-600 whitespace-nowrap">${dt}</td>
      <td class="py-2.5 px-4">${customerInfo}</td>
      <td class="py-2.5 px-4 font-sans">${typeBadge}</td>
      <td class="py-2.5 px-4 font-sans text-slate-800 font-medium">${escapeHtml(item.description)}</td>
      <td class="py-2.5 px-4 text-slate-500">#${item.reference_id || '--'}</td>
      <td class="py-2.5 px-4 text-right">${amountDisplay}</td>
      <td class="py-2.5 px-4 text-right font-bold text-slate-900">${balAfter}</td>
    </tr>`;
  }).join('');
}


// ============================================================================
// UNIVERSAL GLOBAL SEARCH (Customer ID, DID, Customer Name, Extension)
// ============================================================================
let searchDebounceTimer = null;

function handleHeaderSearchInput(event) {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    executeGlobalSearch(event, true);
  }, 250);
}

async function executeGlobalSearch(event, isLiveInput = false) {
  if (event && event.preventDefault && !isLiveInput) event.preventDefault();
  const input = document.getElementById('globalHeaderSearch');
  if (!input) return;
  const query = input.value.trim();
  const dropdown = document.getElementById('globalSearchResultsDropdown');

  if (!query) {
    if (dropdown) dropdown.classList.add('hidden');
    return;
  }

  const isAdmin = Boolean(currentUser && (currentUser.is_admin === 1 || currentUser.is_admin === true || currentUser.role === 'admin'));

  if (!isAdmin) {
    // -------------------------------------------------------------
    // CUSTOMER PORTAL SEARCH: ONLY THEIR OWN REGISTERED NUMBERS
    // -------------------------------------------------------------
    if (!dropdown) return;
    const myDids = currentUserDidsCache || [];
    const cleanQ = query.toLowerCase();
    const matched = myDids.filter(d => {
      const num = String(d.did_number || '').toLowerCase();
      const country = String(d.country || '').toLowerCase();
      return num.includes(cleanQ) || country.includes(cleanQ);
    });

    if (matched.length === 0) {
      dropdown.classList.remove('hidden');
      dropdown.innerHTML = `<div class="p-3 text-center text-slate-500 text-xs">No numbers matching "${escapeHtml(query)}" found in your account.</div>`;
      return;
    }

    if (!isLiveInput && matched.length === 1) {
      selectCustomerOwnDid(matched[0].did_number);
      return;
    }

    dropdown.classList.remove('hidden');
    dropdown.innerHTML = `
      <div class="mb-1">
        <div class="text-[10px] uppercase font-bold text-slate-400 px-2 py-1 tracking-wider border-b border-slate-100 flex items-center justify-between">
          <span>My Registered Numbers (${matched.length})</span>
          <i class="fa-solid fa-phone text-[#28b67a]"></i>
        </div>
        <div class="space-y-1 mt-1">
          ${matched.map(d => `
            <div onclick="selectCustomerOwnDid('${escapeHtml(d.did_number)}')" class="p-2 rounded hover:bg-slate-100 cursor-pointer flex items-center justify-between text-xs transition-colors border border-transparent hover:border-slate-200">
              <div class="flex items-center space-x-2">
                <span class="font-mono font-bold text-[#1d68d8] bg-blue-50 px-2 py-0.5 rounded border border-blue-200 text-xs">${escapeHtml(d.did_number)}</span>
                <span class="text-slate-600 text-[11px]">${escapeHtml(d.country)}</span>
              </div>
              <div class="flex items-center space-x-2">
                <span class="px-2 py-0.5 rounded text-[10px] font-bold ${d.forward_type === 'SIP_URI' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
                  ${d.forward_type === 'SIP_URI' ? 'WebRTC Softphone' : 'PSTN Forward'}
                </span>
                <span class="text-slate-400 text-xs"><i class="fa-solid fa-arrow-right"></i></span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    return;
  }

  // -------------------------------------------------------------
  // ADMIN PORTAL SEARCH: INLINE ON SAME PAGE (NO POPUP MODAL!)
  // -------------------------------------------------------------
  if (dropdown) {
    dropdown.classList.remove('hidden');
    dropdown.innerHTML = '<div class="text-center py-4 text-slate-500 text-xs"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Searching customers & DIDs...</div>';
  }

  try {
    const res = await fetch(`/api/admin/global-search?q=${encodeURIComponent(query)}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Search failed');

    const customers = data.customers || [];
    const dids = data.dids || [];

    // If Enter was pressed (not live input): navigate directly inline on same page
    if (!isLiveInput) {
      if (dropdown) dropdown.classList.add('hidden');
      if (dids.length > 0 && customers.length === 0) {
        showAdminDidInline(dids[0].did_number);
        return;
      }
      if (customers.length > 0 && dids.length === 0) {
        showAdminCustomerInline(customers[0].name || customers[0].order_id || customers[0].id);
        return;
      }
      // Heuristic: If query starts with '+' or contains letters not digits or clean digits > 6, show DIDs, else customers
      if (query.startsWith('+') || query.replace(/[^0-9]/g, '').length >= 7) {
        showAdminDidInline(query);
      } else {
        showAdminCustomerInline(query);
      }
      return;
    }

    if (customers.length === 0 && dids.length === 0) {
      if (dropdown) {
        dropdown.innerHTML = `<div class="p-3 text-center text-slate-500 text-xs font-semibold">No customers or DID numbers match "${escapeHtml(query)}"</div>`;
      }
      return;
    }

    let resultsHtml = '';

    if (customers.length > 0) {
      resultsHtml += `
        <div class="mb-2">
          <div class="text-[10px] uppercase font-bold text-slate-400 px-2 py-1 tracking-wider border-b border-slate-100 flex items-center justify-between">
            <span>Matching Customers (${customers.length})</span>
            <i class="fa-solid fa-users text-[#28b67a]"></i>
          </div>
          <div class="space-y-1 mt-1">
            ${customers.map(c => `
              <div onclick="showAdminCustomerInline('${escapeHtml(c.name || c.order_id || c.id)}')" class="p-2 rounded hover:bg-slate-100 cursor-pointer flex items-center justify-between text-xs transition-colors border border-transparent hover:border-slate-200">
                <div class="flex items-center space-x-2">
                  <div class="w-7 h-7 rounded-full bg-[#366877] text-white flex items-center justify-center font-bold text-xs">
                    ${escapeHtml((c.name || 'U').charAt(0).toUpperCase())}
                  </div>
                  <div>
                    <div class="font-bold text-slate-900">${escapeHtml(c.name)} <span class="text-[10px] font-mono text-slate-400">#${c.id}</span></div>
                    <div class="text-[10px] text-slate-500 font-mono">UID ${escapeHtml(c.order_id || '--')} • ${escapeHtml(c.email)}</div>
                  </div>
                </div>
                <div class="flex items-center space-x-2">
                  <span class="font-mono font-bold text-emerald-600 text-xs">$${parseFloat(c.balance || 0).toFixed(2)}</span>
                  <span class="px-2 py-0.5 rounded bg-[#366877] text-white font-bold text-[10px]">Show in Customers</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    if (dids.length > 0) {
      resultsHtml += `
        <div>
          <div class="text-[10px] uppercase font-bold text-slate-400 px-2 py-1 tracking-wider border-b border-slate-100 flex items-center justify-between">
            <span>Matching DID Numbers (${dids.length})</span>
            <i class="fa-solid fa-globe text-blue-500"></i>
          </div>
          <div class="space-y-1 mt-1">
            ${dids.map(d => {
              const isAlloc = d.status === 'allocated';
              return `
                <div onclick="showAdminDidInline('${escapeHtml(d.did_number)}')" class="p-2 rounded hover:bg-slate-100 cursor-pointer flex items-center justify-between text-xs transition-colors border border-transparent hover:border-slate-200">
                  <div class="flex items-center space-x-2">
                    <span class="font-mono font-bold text-[#1d68d8] bg-blue-50 px-2 py-0.5 rounded border border-blue-200 text-xs">${escapeHtml(d.did_number)}</span>
                    <span class="text-slate-600 text-[11px]">${escapeHtml(d.country)}</span>
                  </div>
                  <div class="flex items-center space-x-2">
                    ${isAlloc ? `
                      <span class="text-[10px] text-slate-600 font-medium font-sans">Owner: <strong>${escapeHtml(d.owner_name || 'Customer')}</strong> (UID ${escapeHtml(d.owner_ext || '--')})</span>
                      <span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">Show in DIDs</span>
                    ` : `
                      <span class="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-bold text-[10px]">Available</span>
                      <span class="px-2 py-0.5 rounded bg-blue-600 text-white font-bold text-[10px]">Show in DIDs</span>
                    `}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    if (dropdown) dropdown.innerHTML = resultsHtml;
  } catch (err) {
    if (dropdown) dropdown.innerHTML = `<div class="p-3 text-center text-rose-500 text-xs">${escapeHtml(err.message)}</div>`;
  }
}

function showAdminCustomerInline(term) {
  const dropdown = document.getElementById('globalSearchResultsDropdown');
  if (dropdown) dropdown.classList.add('hidden');

  switchTab('admin');
  switchAdminSubtab('users');

  const input = document.getElementById('adminSearchInput');
  if (input) {
    input.value = term;
    filterAdminUsers();
  }

  setTimeout(() => {
    const table = document.getElementById('adminUsersTableBody');
    if (table) table.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 100);
}

function showAdminDidInline(didNumber) {
  const dropdown = document.getElementById('globalSearchResultsDropdown');
  if (dropdown) dropdown.classList.add('hidden');

  switchTab('admin');
  switchAdminSubtab('dids');

  const input = document.getElementById('adminDidSearchInput');
  if (input) {
    input.value = didNumber;
    filterAdminDids();
  }

  setTimeout(() => {
    const table = document.getElementById('adminDidsTableBody');
    if (table) table.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 100);
}

function selectCustomerOwnDid(didNumber) {
  const dropdown = document.getElementById('globalSearchResultsDropdown');
  if (dropdown) dropdown.classList.add('hidden');

  if (currentTab === 'routes') {
    const rows = document.querySelectorAll('#myDidsTableBody tr');
    rows.forEach(r => {
      if (r.textContent.includes(didNumber)) {
        r.classList.add('bg-emerald-50', 'ring-2', 'ring-emerald-400');
        r.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        r.classList.remove('bg-emerald-50', 'ring-2', 'ring-emerald-400');
      }
    });
  } else {
    switchTab('dialer');
    setTimeout(() => {
      const el = document.getElementById(`webrtc-did-${didNumber.replace(/[^0-9]/g, '')}`);
      if (el) {
        el.classList.add('ring-2', 'ring-[#28b67a]', 'bg-emerald-50');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => el.classList.remove('ring-2', 'ring-[#28b67a]', 'bg-emerald-50'), 4000);
      } else {
        const container = document.getElementById('subscriberIncomingDidsContainer');
        if (container) container.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }
}

// Function aliases for backward compatibility
function selectGlobalCustomer(name, orderId, id) {
  showAdminCustomerInline(name || orderId || id);
}

function selectGlobalDid(didId, userId, didNumber) {
  showAdminDidInline(didNumber);
}

// Close global search dropdown when clicking outside
document.addEventListener('click', (e) => {
  const searchBox = document.getElementById('headerSearchContainer');
  const dropdown = document.getElementById('globalSearchResultsDropdown');
  if (searchBox && dropdown && !searchBox.contains(e.target)) {
    dropdown.classList.add('hidden');
  }
});
