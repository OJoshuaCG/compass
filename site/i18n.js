// Cambio de idioma español <-> inglés. El HTML está en español (idioma base, también sin
// JavaScript); aquí se guarda solo la traducción al inglés, indexada por el texto en español.
(function () {
  var STORAGE_KEY = 'compass-lang';

  // DICT-START (JSON válido: lo lee una comprobación que exige cubrir todos los textos del HTML)
  var EN = {
    "Compass: identidad, accesos y bóveda para tu equipo": "Compass: identity, access and vault for your team",
    "Compass es una plataforma interna para gestionar quién puede entrar a qué, y guardar y compartir cuentas de plataformas externas con sus segundos factores, con un registro que nadie puede reescribir.": "Compass is an internal platform to manage who can access what, and to store and share external platform accounts with their second factors, backed by a record nobody can rewrite.",
    "Compass: identidad, accesos y bóveda": "Compass: identity, access and vault",
    "Quién entra a qué, cuentas compartidas con segundo factor y un registro a prueba de manipulación.": "Who gets access to what, shared accounts with a second factor, and a tamper-proof record.",
    "Saltar al contenido": "Skip to content",
    "Compass, inicio": "Compass, home",
    "Principal": "Main",
    "Problema": "Problem",
    "Capacidades": "Features",
    "Jerarquía": "Hierarchy",
    "Seguridad": "Security",
    "Estado": "Status",
    "Cambiar el idioma a inglés": "Switch language to Spanish",
    "Cambiar tema claro u oscuro": "Switch between light and dark theme",
    "Ver en GitHub": "View on GitHub",
    "Plataforma interna": "Internal platform",
    "Quién entra a qué,": "Who gets in where,",
    "bajo control": "under control",
    "Compass gestiona las personas de tu equipo y custodia las cuentas de plataformas externas con sus segundos factores, sin pasar contraseñas por chat ni hojas de cálculo. Cada acceso importante queda en un registro que nadie puede reescribir.": "Compass manages the people on your team and safeguards external platform accounts with their second factors, with no passwords passed around in chat or spreadsheets. Every important access is kept in a record nobody can rewrite.",
    "Qué puede hacer": "What it can do",
    "En qué punto está": "Where it stands",
    "En desarrollo.": "Under development.",
    "Todavía no se cargan credenciales reales: antes hace falta cerrar la fase 1 y pasar una prueba de penetración externa.": "No real credentials are loaded yet: phase 1 must be completed and an external penetration test passed first.",
    "Ejemplo ilustrativo del registro de auditoría": "Illustrative example of the audit log",
    "Registro de auditoría": "Audit log",
    "ejemplo": "example",
    "permitido": "allowed",
    "negado": "denied",
    "Operador revela una credencial compartida": "Operator reveals a shared credential",
    "Líder intenta ver un secreto que no se le compartió": "Lead tries to view a secret that was not shared with them",
    "Operador usa un código 2FA sin ver el secreto": "Operator uses a 2FA code without seeing the secret",
    "Las acciones negadas también quedan registradas.": "Denied actions are recorded too.",
    "El problema": "The problem",
    "Los accesos suelen vivir en una hoja de cálculo": "Access usually lives in a spreadsheet",
    "O en la memoria de unas pocas personas. Compass sustituye cada hábito riesgoso por una regla clara.": "Or in the memory of a few people. Compass replaces each risky habit with a clear rule.",
    "Contraseñas compartidas por chat o correo": "Passwords shared over chat or email",
    "Se comparten dentro del sistema, con nivel de acceso y vencimiento opcional.": "They are shared inside the system, with an access level and an optional expiry.",
    "El código de verificación vive en el teléfono de una sola persona": "The verification code lives on one person's phone",
    "El sistema guarda el secreto y entrega el código a quien tenga permiso.": "The system keeps the secret and hands the code to whoever has permission.",
    "Alguien se va y nadie sabe qué cambiar": "Someone leaves and nobody knows what to change",
    "La baja señala qué conocía esa persona para rotarlo.": "Offboarding flags what that person knew so it can be rotated.",
    "Nadie sabe quién entró a una cuenta": "Nobody knows who accessed an account",
    "Toda revelación y todo uso quedan en la auditoría.": "Every reveal and every use is kept in the audit log.",
    "Seis piezas que trabajan juntas": "Six pieces that work together",
    "Pensado para un equipo pequeño, con un diseño que ya permite crecer a varias organizaciones.": "Built for a small team, with a design that already allows growing to several organizations.",
    "Personas y jerarquía": "People and hierarchy",
    "Cuatro niveles. Cada persona solo gestiona a quien está por debajo de ella en su propia línea.": "Four levels. Each person only manages those below them in their own line.",
    "Entrada segura": "Secure sign-in",
    "Nadie se registra por su cuenta: se entra por invitación, con contraseña y segundo factor obligatorio, o con llave de acceso.": "Nobody signs up on their own: you join by invitation, with a password and a mandatory second factor, or with a passkey.",
    "Bóveda compartida": "Shared vault",
    "Las credenciales se comparten con niveles claros (usar, ver, editar, gestionar) y los secretos viven cifrados.": "Credentials are shared with clear levels (use, view, edit, manage) and secrets are stored encrypted.",
    "Segundo factor centralizado": "Centralized second factor",
    "Un operador puede usar el código de una cuenta sin llegar a conocer el secreto que lo genera.": "An operator can use an account's code without ever learning the secret that generates it.",
    "Registro a prueba de manipulación": "Tamper-proof record",
    "Quién hizo qué, cuándo y con qué resultado, incluidas las acciones que se negaron.": "Who did what, when and with what outcome, including the actions that were denied.",
    "Salida ordenada": "Orderly offboarding",
    "Cuando alguien deja el equipo se cierra su acceso y se señalan los secretos que conoció para cambiarlos.": "When someone leaves the team their access is closed and the secrets they knew are flagged to be changed.",
    "Cuatro rangos, una línea de responsabilidad": "Four ranks, one line of responsibility",
    "Ser jefe de alguien no da acceso a sus cuentas: el acceso a un secreto solo existe si alguien lo comparte de forma explícita y auditada.": "Being someone's manager does not grant access to their accounts: access to a secret exists only if someone shares it explicitly and with an audit trail.",
    "Raíz": "Root",
    "Responsable de la organización. Una sola persona.": "Owner of the organization. One person only.",
    "Administrador": "Administrator",
    "Gestiona su rama de Líderes y Operadores.": "Manages their branch of Leads and Operators.",
    "Líder": "Lead",
    "Gestiona a los Operadores de su rama.": "Manages the Operators in their branch.",
    "Operador": "Operator",
    "Usa las cuentas que le comparten.": "Uses the accounts shared with them.",
    "Cuando chocan seguridad y velocidad, gana la seguridad": "When security and speed collide, security wins",
    "Compass guarda secretos reales de una empresa. Estas reglas guían cada decisión de diseño.": "Compass stores a company's real secrets. These rules guide every design decision.",
    "Se niega por defecto": "Deny by default",
    "Si ninguna regla autoriza una acción, la acción no ocurre.": "If no rule authorizes an action, the action does not happen.",
    "Nadie otorga lo que no tiene": "Nobody grants what they do not have",
    "Una persona no puede dar a otra un permiso superior al suyo.": "A person cannot give another a permission higher than their own.",
    "Si no se puede auditar, no se hace": "If it cannot be audited, it is not done",
    "Las acciones sensibles se rechazan si el sistema no logra dejar constancia.": "Sensitive actions are rejected if the system cannot leave a record.",
    "Sin criptografía inventada": "No homemade cryptography",
    "Se usan componentes auditados y ampliamente aceptados.": "Audited, widely accepted components are used.",
    "Aislamiento por organización": "Isolation per organization",
    "Los datos de cada organización se separan desde la base de datos.": "Each organization's data is separated at the database level.",
    "Nada se borra": "Nothing is deleted",
    "Las personas se desactivan y las cuentas se archivan: la historia se mantiene.": "People are deactivated and accounts are archived: the history is kept.",
    "Se entrega por fases usables": "Delivered in usable phases",
    "No se abre una fase hasta cumplir los criterios de salida de la anterior. No se estiman fechas.": "A phase does not start until the previous one meets its exit criteria. No dates are estimated.",
    "Terminada": "Done",
    "0 · Fundaciones": "0 · Foundations",
    "Base técnica, aislamiento por organización, cifrado, registro y diseño visual.": "Technical base, per-organization isolation, encryption, audit log and visual design.",
    "Funciona en lo esencial": "Works in essentials",
    "1a · Identidad": "1a · Identity",
    "Invitaciones, contraseña, segundo factor, llaves de acceso, sesiones, permisos y directorio.": "Invitations, password, second factor, passkeys, sessions, permissions and directory.",
    "En curso": "In progress",
    "1b · Bóveda y segundo factor": "1b · Vault and second factor",
    "Cuentas, credenciales con revelado auditado, uso compartido e importación.": "Accounts, credentials with audited reveal, sharing and import.",
    "Pendiente": "Pending",
    "1c · Gobernanza": "1c · Governance",
    "Pantalla de auditoría, bajas con rotación, salud de credenciales y acceso temporal.": "Audit screen, offboarding with rotation, credential health and temporary access.",
    "Construida en lo esencial": "Built in essentials",
    "4 · Códigos por correo": "4 · Codes by email",
    "Lectura de códigos que llegan por correo, compartidos por vistas filtradas.": "Reading of codes that arrive by email, shared through filtered views.",
    "2, 3, 5, 6 y 7": "2, 3, 5, 6 and 7",
    "Inicio de sesión único, SAML y SCIM, SMS, extensión de navegador y broker de sesiones.": "Single sign-on, SAML and SCIM, SMS, browser extension and session broker.",
    "Conoce el diseño completo": "Explore the full design",
    "El producto, sus reglas, las decisiones de arquitectura y el modelo de amenazas están documentados en el repositorio.": "The product, its rules, the architecture decisions and the threat model are documented in the repository.",
    "Leer la documentación": "Read the documentation",
    "© 2026 Compass · Creado por": "© 2026 Compass · Created by",
    "Código fuente en GitHub": "Source code on GitHub"
  };
  // DICT-END

  var ATTRS = ['aria-label', 'alt'];
  var META = [
    'meta[name="description"]',
    'meta[property="og:title"]',
    'meta[property="og:description"]'
  ];
  var originalText = new WeakMap();
  var originalAttrs = new WeakMap();
  var current = 'es';

  function norm(value) {
    return value.replace(/\s+/g, ' ').trim();
  }

  // Traduce conservando los espacios que rodean al texto original (sangría y saltos de línea).
  function translate(raw, lang) {
    if (lang === 'es') return raw;
    var key = norm(raw);
    if (!Object.prototype.hasOwnProperty.call(EN, key)) return raw;
    var lead = raw.match(/^\s*/)[0];
    var trail = raw.match(/\s*$/)[0];
    return lead + EN[key] + trail;
  }

  function apply(lang) {
    current = lang;
    document.documentElement.setAttribute('lang', lang);

    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var tag = node.parentNode && node.parentNode.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || !norm(node.nodeValue)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode())) {
      if (!originalText.has(node)) originalText.set(node, node.nodeValue);
      node.nodeValue = translate(originalText.get(node), lang);
    }

    document.querySelectorAll('[aria-label], [alt]').forEach(function (el) {
      var saved = originalAttrs.get(el) || {};
      ATTRS.forEach(function (attr) {
        if (!el.hasAttribute(attr)) return;
        if (!(attr in saved)) saved[attr] = el.getAttribute(attr);
        el.setAttribute(attr, translate(saved[attr], lang));
      });
      originalAttrs.set(el, saved);
    });

    META.forEach(function (selector) {
      var el = document.querySelector(selector);
      if (!el) return;
      var saved = originalAttrs.get(el) || {};
      if (!('content' in saved)) saved.content = el.getAttribute('content');
      el.setAttribute('content', translate(saved.content, lang));
      originalAttrs.set(el, saved);
    });

    var title = document.querySelector('title');
    if (!originalText.has(title)) originalText.set(title, title.textContent);
    title.textContent = translate(originalText.get(title), lang);

    // El botón muestra el idioma al que se cambiaría.
    var label = document.getElementById('lang-label');
    if (label) label.textContent = lang === 'es' ? 'EN' : 'ES';
  }

  function initial() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'es' || saved === 'en') return saved;
    } catch (e) {
      // Almacenamiento bloqueado: se usa el idioma del navegador.
    }
    return /^en/i.test(navigator.language || '') ? 'en' : 'es';
  }

  var button = document.getElementById('lang-toggle');
  if (button) {
    button.addEventListener('click', function () {
      var next = current === 'es' ? 'en' : 'es';
      apply(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch (e) {
        // Sin almacenamiento, el cambio vale solo para esta visita.
      }
    });
  }

  apply(initial());
})();
