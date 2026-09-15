const nodemailer = require('nodemailer');
const store = require('./store');

let transporter = null;

function parseEmails(value) {
  return String(value || '')
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getTargetContactEmails() {
  const settings = store.findAll('settings')[0] || {};
  const values = [
    ...(process.env.CONTACT_EMAIL ? parseEmails(process.env.CONTACT_EMAIL) : []),
    ...(process.env.SMTP_USER ? parseEmails(process.env.SMTP_USER) : []),
    ...(settings.email ? parseEmails(settings.email) : []),
    ...(process.env.EMAIL_TO ? parseEmails(process.env.EMAIL_TO) : []),
  ];
  return [...new Set(values.filter((email) => /@/.test(email)))];
}

function getTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_PORT || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    throw new Error('Le service e-mail n\'est pas configuré. Définissez les variables SMTP dans backend/.env.');
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }
  return transporter;
}

async function sendPasswordResetEmail({ to, firstName, resetCode, resetUrl }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const codeText = resetCode
    ? `Votre code de vérification est : ${resetCode}\n\nEntrez ce code dans l'application pour définir votre nouveau mot de passe.`
    : `Utilisez ce lien pour réinitialiser votre mot de passe : ${resetUrl}`;

  const codeHtml = resetCode
    ? `<p>Votre code de vérification est : <strong>${resetCode}</strong></p><p>Entrez ce code dans l'application pour définir votre nouveau mot de passe.</p>`
    : `<p><a href="${resetUrl}">Réinitialiser mon mot de passe</a></p>`;

  await getTransporter().sendMail({
    from,
    to,
    subject: resetCode ? 'Code de réinitialisation de votre mot de passe' : 'Réinitialisation de votre mot de passe',
    text: `Bonjour ${firstName || ''},\n\n${codeText}\n\nCe code expire dans ${process.env.PASSWORD_RESET_EXPIRES_MINUTES || 30} minutes.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.`,
    html: `<p>Bonjour ${firstName || ''},</p>${codeHtml}<p>Ce code expire dans ${process.env.PASSWORD_RESET_EXPIRES_MINUTES || 30} minutes.</p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p>`,
  });
}

async function sendContactNotification({ firstName, lastName, email, company, subject, message, type = 'contact' }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const appointmentLabel = type === 'appointment' ? 'Demande de rendez-vous' : 'Nouveau message de contact';
  const to = getTargetContactEmails();

  if (!to.length) {
    throw new Error('Aucune adresse e-mail cible configurée pour les notifications. Ajoutez CONTACT_EMAIL ou SMTP_USER dans backend/.env.');
  }

  await Promise.all(to.map((target) => getTransporter().sendMail({
    from,
    to: target,
    replyTo: email,
    subject: `${appointmentLabel} — ${firstName} ${lastName}`,
    text: `Nom : ${firstName} ${lastName}\nE-mail : ${email}\nEntreprise : ${company || 'Non renseignée'}\nObjet : ${subject || appointmentLabel}\n\n${message}`,
    html: `<h2>${appointmentLabel}</h2><p><strong>Nom :</strong> ${firstName} ${lastName}</p><p><strong>E-mail :</strong> ${email}</p><p><strong>Entreprise :</strong> ${company || 'Non renseignée'}</p><p><strong>Objet :</strong> ${subject || appointmentLabel}</p><p>${String(message).replace(/\n/g, '<br>')}</p>`,
  })));
}

async function sendContactAutoReply({ to, firstName, type = 'contact' }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const subject = type === 'appointment' ? 'Votre demande de rendez-vous a bien été reçue' : 'Merci pour votre message — Cabinet Comptable';
  const text = `Bonjour ${firstName},\n\nNous avons bien reçu votre message. Notre équipe vous répondra rapidement. Le Cabinet Comptable vous accompagne en comptabilité, fiscalité, gestion, formation et suivi de mémoire.\n\nMerci pour votre confiance.\n\nL'équipe du Cabinet Comptable`;
  await getTransporter().sendMail({
    from,
    to,
    subject,
    text,
    html: `<p>Bonjour ${firstName},</p><p>Nous avons bien reçu votre message. Notre équipe vous répondra rapidement.</p><p>Le Cabinet Comptable vous accompagne en comptabilité, fiscalité, gestion, formation et suivi de mémoire.</p><p>Merci pour votre confiance.</p><p>L'équipe du Cabinet Comptable</p>`,
  });
}

async function sendAcademicRequestEmails({ to, firstName, lastName, email, company, need }) {
  const questions = [
    '1. Quel est ton niveau, ta filière et ton établissement ?',
    '2. Quel est ton sujet de mémoire et est-il déjà validé ?',
    '3. Où en es-tu actuellement dans la réalisation du mémoire ?',
    '4. Quelles sont tes principales difficultés ?',
    '5. Qu’attends-tu précisément de mon accompagnement ?',
  ].join('\n');
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const cabinetEmails = getTargetContactEmails();

  if (!cabinetEmails.length) {
    throw new Error('Aucune adresse e-mail cible configurée pour les notifications. Ajoutez CONTACT_EMAIL ou SMTP_USER dans backend/.env.');
  }

  await Promise.all(cabinetEmails.map((target) => getTransporter().sendMail({
    from,
    to: target,
    replyTo: email,
    subject: `Nouvelle demande de suivi de mémoire — ${firstName} ${lastName}`,
    text: `Nom : ${firstName} ${lastName}\nE-mail : ${email}\nÉtablissement : ${company || 'Non renseigné'}\n\nBesoin indiqué :\n${need}\n\nQuestions à préciser :\n${questions}`,
    html: `<h2>Nouvelle demande de suivi de mémoire</h2><p><strong>Nom :</strong> ${firstName} ${lastName}</p><p><strong>E-mail :</strong> ${email}</p><p><strong>Établissement :</strong> ${company || 'Non renseigné'}</p><p><strong>Besoin indiqué :</strong><br>${String(need).replace(/\n/g, '<br>')}</p><h3>Questions à préciser</h3><ol><li>Quel est ton niveau, ta filière et ton établissement ?</li><li>Quel est ton sujet de mémoire et est-il déjà validé ?</li><li>Où en es-tu actuellement dans la réalisation du mémoire ?</li><li>Quelles sont tes principales difficultés ?</li><li>Qu’attends-tu précisément de mon accompagnement ?</li></ol>`,
  })));

  await getTransporter().sendMail({
    from,
    to,
    subject: 'Votre demande de suivi de mémoire a bien été reçue',
    text: `Bonjour ${firstName},\n\nMerci pour votre demande de suivi de mémoire. Pour mieux vous accompagner, merci de répondre aux questions suivantes :\n\n${questions}\n\nNous vous répondrons dès réception de vos précisions.\n\nL'équipe du Cabinet Comptable`,
    html: `<p>Bonjour ${firstName},</p><p>Merci pour votre demande de suivi de mémoire. Pour mieux vous accompagner, merci de répondre aux questions suivantes :</p><ol><li>Quel est ton niveau, ta filière et ton établissement ?</li><li>Quel est ton sujet de mémoire et est-il déjà validé ?</li><li>Où en es-tu actuellement dans la réalisation du mémoire ?</li><li>Quelles sont tes principales difficultés ?</li><li>Qu’attends-tu précisément de mon accompagnement ?</li></ol><p>Nous vous répondrons dès réception de vos précisions.</p><p>L'équipe du Cabinet Comptable</p>`,
  });
}

async function sendServiceRequestAutoReply({ to, firstName, type = 'service' }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const labels = {
    quote: 'demande de devis',
    service: 'demande de prestation',
  };
  const label = labels[type] || labels.service;
  await getTransporter().sendMail({
    from,
    to,
    subject: `Votre ${label} a bien été reçue`,
    text: `Bonjour ${firstName},\n\nNous avons bien reçu votre ${label}. Notre équipe va l'étudier et vous répondra sous 24 heures.\n\nMerci pour votre confiance.\n\nL'équipe du Cabinet Comptable`,
    html: `<p>Bonjour ${firstName},</p><p>Nous avons bien reçu votre ${label}. Notre équipe va l'étudier et vous répondra sous 24 heures.</p><p>Merci pour votre confiance.</p><p>L'équipe du Cabinet Comptable</p>`,
  });
}

module.exports = {
  sendPasswordResetEmail,
  sendContactNotification,
  sendContactAutoReply,
  sendAcademicRequestEmails,
  sendServiceRequestAutoReply,
};
