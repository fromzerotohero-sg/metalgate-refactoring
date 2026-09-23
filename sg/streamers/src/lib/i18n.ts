export const LOCALES = ["it", "en", "es"] as const;

export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  it: "IT",
  en: "EN",
  es: "ES",
};

type Copy = {
  loadingSession: string;
  loadingDashboard: string;
  sessionExpired: string;
  dashboardLoadFailed: string;
  loginFailed: string;
  copySuccess: string;
  copyFailure: string;
  partnerPortal: string;
  loginTitlePrimary: string;
  loginTitleAccent: string;
  loginLead: string;
  loginBenefitEarnings: string;
  loginBenefitReferrals: string;
  loginBenefitTeam: string;
  loginCardTitle: string;
  loginCardLead: string;
  streamerCode: string;
  streamerCodePlaceholder: string;
  password: string;
  show: string;
  hide: string;
  loginSubmitting: string;
  login: string;
  sessionNotice: string;
  loadError: string;
  loadErrorTitle: string;
  retry: string;
  logout: string;
  manager: string;
  partnerStreamer: string;
  overview: string;
  greeting: (code: string | null | undefined) => string;
  overviewLead: string;
  referralCode: string;
  personalStatistics: string;
  availableBalance: string;
  grossAmount: string;
  totalEarned: string;
  referralUsers: string;
  registeredWithCode: string;
  referralLink: string;
  referralTitle: string;
  referralLead: string;
  copyLink: string;
  team: string;
  yourStreamers: string;
  directMembers: (count: string) => string;
  streamersInTeam: string;
  teamBalance: string;
  totalTeamEarned: string;
  code: string;
  balance: string;
  referrals: string;
  actions: string;
  showAll: string;
  viewSubscribers: string;
  noStreamers: string;
  network: string;
  subscribersOf: (code: string) => string;
  yourSubscribers: string;
  streamerFilter: string;
  wholeNetwork: string;
  totalSubscribers: string;
  totalSpent: string;
  creditsPurchased: string;
  creditsUsed: string;
  clearFilter: (code: string) => string;
  networkPageNote: string;
  user: string;
  streamer: string;
  spent: string;
  registeredOn: string;
  noSubscribers: string;
  pageSummary: (page: number, totalPages: number, total: string, noun: string) => string;
  previous: string;
  next: string;
  subscribers: string;
  streamers: string;
  footer: string;
};

export const COPY: Record<Locale, Copy> = {
  it: {
    loadingSession: "Verifica della sessione…",
    loadingDashboard: "Caricamento della dashboard…",
    sessionExpired: "La sessione è scaduta. Accedi di nuovo.",
    dashboardLoadFailed: "Non è stato possibile caricare la dashboard.",
    loginFailed: "Accesso non riuscito.",
    copySuccess: "Link copiato.",
    copyFailure: "Copia il link dal campo qui sopra.",
    partnerPortal: "Portale partner",
    loginTitlePrimary: "Il tuo network.",
    loginTitleAccent: "Tutto sotto controllo.",
    loginLead: "Accedi con le credenziali streamer per visualizzare risultati, referral e andamento del tuo team.",
    loginBenefitEarnings: "Guadagni e saldo disponibili",
    loginBenefitReferrals: "Panoramica completa dei referral",
    loginBenefitTeam: "Monitoraggio del team manageriale",
    loginCardTitle: "Accedi al portale",
    loginCardLead: "Usa il codice e la password ricevuti dal team.",
    streamerCode: "Codice streamer",
    streamerCodePlaceholder: "Es. NICK2024",
    password: "Password",
    show: "Mostra",
    hide: "Nascondi",
    loginSubmitting: "Accesso in corso…",
    login: "Accedi al portale",
    sessionNotice: "La sessione resta attiva solo in questa scheda del browser.",
    loadError: "Errore di caricamento",
    loadErrorTitle: "Non riusciamo a mostrare i tuoi dati.",
    retry: "Riprova",
    logout: "Esci",
    manager: "Manager",
    partnerStreamer: "Streamer partner",
    overview: "Panoramica",
    greeting: (code) => `Ciao, ${code ?? ""}`,
    overviewLead: "Monitora le entrate e la crescita della tua community.",
    referralCode: "Codice referral",
    personalStatistics: "Statistiche personali",
    availableBalance: "Saldo disponibile",
    grossAmount: "Importo lordo",
    totalEarned: "Totale guadagnato",
    referralUsers: "Utenti referral",
    registeredWithCode: "Registrati con il tuo codice",
    referralLink: "Link referral",
    referralTitle: "Condividi il tuo invito",
    referralLead: "Chi si registra con questo link verrà attribuito automaticamente al tuo profilo.",
    copyLink: "Copia link",
    team: "Team",
    yourStreamers: "I tuoi streamer",
    directMembers: (count) => `${count} membri diretti`,
    streamersInTeam: "Streamer nel team",
    teamBalance: "Saldo team",
    totalTeamEarned: "Totale guadagnato team",
    code: "Codice",
    balance: "Saldo",
    referrals: "Referral",
    actions: "Azioni",
    showAll: "Mostra tutti",
    viewSubscribers: "Vedi iscritti",
    noStreamers: "Non ci sono ancora streamer nel tuo team.",
    network: "Network",
    subscribersOf: (code) => `Iscritti di ${code}`,
    yourSubscribers: "I tuoi iscritti",
    streamerFilter: "Filtro per streamer selezionato",
    wholeNetwork: "Tutta la tua rete, inclusi i referral del team",
    totalSubscribers: "Iscritti totali",
    totalSpent: "Totale speso",
    creditsPurchased: "Crediti acquistati",
    creditsUsed: "Crediti utilizzati",
    clearFilter: (code) => `× Rimuovi filtro ${code}`,
    networkPageNote: "Il filtro mostra i risultati presenti nella pagina corrente della rete.",
    user: "Utente",
    streamer: "Streamer",
    spent: "Spesa",
    registeredOn: "Registrato il",
    noSubscribers: "Nessun iscritto da mostrare.",
    pageSummary: (page, totalPages, total, noun) => `Pagina ${page} di ${totalPages} · ${total} ${noun}`,
    previous: "← Precedente",
    next: "Successiva →",
    subscribers: "iscritti",
    streamers: "streamer",
    footer: "From Zero To Hero · Portale Streamer",
  },
  en: {
    loadingSession: "Checking your session…",
    loadingDashboard: "Loading dashboard…",
    sessionExpired: "Your session has expired. Please sign in again.",
    dashboardLoadFailed: "We couldn't load the dashboard.",
    loginFailed: "Sign-in failed.",
    copySuccess: "Link copied.",
    copyFailure: "Copy the link from the field above.",
    partnerPortal: "Partner portal",
    loginTitlePrimary: "Your network.",
    loginTitleAccent: "Under control.",
    loginLead: "Sign in with your streamer credentials to view results, referrals, and your team's performance.",
    loginBenefitEarnings: "Earnings and available balance",
    loginBenefitReferrals: "Complete referral overview",
    loginBenefitTeam: "Management team monitoring",
    loginCardTitle: "Sign in to the portal",
    loginCardLead: "Use the code and password provided by the team.",
    streamerCode: "Streamer code",
    streamerCodePlaceholder: "E.g. NICK2024",
    password: "Password",
    show: "Show",
    hide: "Hide",
    loginSubmitting: "Signing in…",
    login: "Sign in to the portal",
    sessionNotice: "Your session remains active only in this browser tab.",
    loadError: "Loading error",
    loadErrorTitle: "We can't show your data.",
    retry: "Try again",
    logout: "Sign out",
    manager: "Manager",
    partnerStreamer: "Partner streamer",
    overview: "Overview",
    greeting: (code) => `Hello, ${code ?? ""}`,
    overviewLead: "Track your earnings and the growth of your community.",
    referralCode: "Referral code",
    personalStatistics: "Personal statistics",
    availableBalance: "Available balance",
    grossAmount: "Gross amount",
    totalEarned: "Total earned",
    referralUsers: "Referred users",
    registeredWithCode: "Registered with your code",
    referralLink: "Referral link",
    referralTitle: "Share your invitation",
    referralLead: "Anyone who signs up with this link will automatically be attributed to your profile.",
    copyLink: "Copy link",
    team: "Team",
    yourStreamers: "Your streamers",
    directMembers: (count) => `${count} direct members`,
    streamersInTeam: "Streamers in team",
    teamBalance: "Team balance",
    totalTeamEarned: "Total team earnings",
    code: "Code",
    balance: "Balance",
    referrals: "Referrals",
    actions: "Actions",
    showAll: "Show all",
    viewSubscribers: "View subscribers",
    noStreamers: "There are no streamers in your team yet.",
    network: "Network",
    subscribersOf: (code) => `${code}'s subscribers`,
    yourSubscribers: "Your subscribers",
    streamerFilter: "Selected streamer filter",
    wholeNetwork: "Your whole network, including team referrals",
    totalSubscribers: "Total subscribers",
    totalSpent: "Total spent",
    creditsPurchased: "Credits purchased",
    creditsUsed: "Credits used",
    clearFilter: (code) => `× Clear ${code} filter`,
    networkPageNote: "The filter shows results available on the current network page.",
    user: "User",
    streamer: "Streamer",
    spent: "Spent",
    registeredOn: "Registered on",
    noSubscribers: "No subscribers to show.",
    pageSummary: (page, totalPages, total, noun) => `Page ${page} of ${totalPages} · ${total} ${noun}`,
    previous: "← Previous",
    next: "Next →",
    subscribers: "subscribers",
    streamers: "streamers",
    footer: "From Zero To Hero · Streamer Portal",
  },
  es: {
    loadingSession: "Comprobando tu sesión…",
    loadingDashboard: "Cargando el panel…",
    sessionExpired: "Tu sesión ha caducado. Vuelve a iniciar sesión.",
    dashboardLoadFailed: "No se ha podido cargar el panel.",
    loginFailed: "No se ha podido iniciar sesión.",
    copySuccess: "Enlace copiado.",
    copyFailure: "Copia el enlace del campo de arriba.",
    partnerPortal: "Portal de socios",
    loginTitlePrimary: "Tu red.",
    loginTitleAccent: "Todo bajo control.",
    loginLead: "Inicia sesión con tus credenciales de streamer para consultar resultados, referidos y el rendimiento de tu equipo.",
    loginBenefitEarnings: "Ganancias y saldo disponible",
    loginBenefitReferrals: "Resumen completo de referidos",
    loginBenefitTeam: "Seguimiento del equipo de gestión",
    loginCardTitle: "Accede al portal",
    loginCardLead: "Usa el código y la contraseña recibidos del equipo.",
    streamerCode: "Código de streamer",
    streamerCodePlaceholder: "Ej. NICK2024",
    password: "Contraseña",
    show: "Mostrar",
    hide: "Ocultar",
    loginSubmitting: "Iniciando sesión…",
    login: "Accede al portal",
    sessionNotice: "La sesión solo permanece activa en esta pestaña del navegador.",
    loadError: "Error de carga",
    loadErrorTitle: "No podemos mostrar tus datos.",
    retry: "Reintentar",
    logout: "Salir",
    manager: "Manager",
    partnerStreamer: "Streamer asociado",
    overview: "Resumen",
    greeting: (code) => `Hola, ${code ?? ""}`,
    overviewLead: "Supervisa tus ganancias y el crecimiento de tu comunidad.",
    referralCode: "Código de referido",
    personalStatistics: "Estadísticas personales",
    availableBalance: "Saldo disponible",
    grossAmount: "Importe bruto",
    totalEarned: "Total ganado",
    referralUsers: "Usuarios referidos",
    registeredWithCode: "Registrados con tu código",
    referralLink: "Enlace de referido",
    referralTitle: "Comparte tu invitación",
    referralLead: "Quien se registre con este enlace se atribuirá automáticamente a tu perfil.",
    copyLink: "Copiar enlace",
    team: "Equipo",
    yourStreamers: "Tus streamers",
    directMembers: (count) => `${count} miembros directos`,
    streamersInTeam: "Streamers del equipo",
    teamBalance: "Saldo del equipo",
    totalTeamEarned: "Total ganado por el equipo",
    code: "Código",
    balance: "Saldo",
    referrals: "Referidos",
    actions: "Acciones",
    showAll: "Mostrar todos",
    viewSubscribers: "Ver suscriptores",
    noStreamers: "Todavía no hay streamers en tu equipo.",
    network: "Red",
    subscribersOf: (code) => `Suscriptores de ${code}`,
    yourSubscribers: "Tus suscriptores",
    streamerFilter: "Filtro de streamer seleccionado",
    wholeNetwork: "Toda tu red, incluidos los referidos del equipo",
    totalSubscribers: "Total de suscriptores",
    totalSpent: "Total gastado",
    creditsPurchased: "Créditos comprados",
    creditsUsed: "Créditos utilizados",
    clearFilter: (code) => `× Quitar filtro de ${code}`,
    networkPageNote: "El filtro muestra los resultados disponibles en la página actual de la red.",
    user: "Usuario",
    streamer: "Streamer",
    spent: "Gastado",
    registeredOn: "Registrado el",
    noSubscribers: "No hay suscriptores que mostrar.",
    pageSummary: (page, totalPages, total, noun) => `Página ${page} de ${totalPages} · ${total} ${noun}`,
    previous: "← Anterior",
    next: "Siguiente →",
    subscribers: "suscriptores",
    streamers: "streamers",
    footer: "From Zero To Hero · Portal de Streamers",
  },
};
