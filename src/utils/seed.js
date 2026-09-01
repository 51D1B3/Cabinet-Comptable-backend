const bcrypt = require('bcryptjs');

const ROLES = {
  VISITOR:           'visitor',
  CLIENT:            'client',
  ASSISTANT:         'assistant',
  ACCOUNTANT:        'accountant',
  ACCOUNTING_MANAGER:'accounting_manager',
  DIRECTOR:          'director',
  ADMIN:             'admin',
  SUPER_ADMIN:       'super_admin',
};

const STAFF_ROLES = [
  ROLES.ASSISTANT,
  ROLES.ACCOUNTANT,
  ROLES.ACCOUNTING_MANAGER,
  ROLES.DIRECTOR,
  ROLES.ADMIN,
  ROLES.SUPER_ADMIN,
];

const ADMIN_ROLES = [
  ROLES.ADMIN,
  ROLES.SUPER_ADMIN,
  ROLES.DIRECTOR,
  ROLES.ACCOUNTING_MANAGER,
];

async function seedIfEmpty(store) {
  const users = store.findAll('users');
  /* Ne rien faire si les comptes staff existent déjà */
  if (users.length > 0) return;

  const passwordHash = await bcrypt.hash('Admin123!', 10);

  await store.create('users', {
    firstName: 'Aïssata',
    lastName: 'Diallo',
    email: 'admin@cabcomptable.ml',
    phone: '+22376928012',
    passwordHash,
    role: ROLES.SUPER_ADMIN,
    emailVerified: true,
    status: 'active',
    companyId: null,
    preferences: { emailNotifications: true },
  });

  await store.create('users', {
    firstName: 'Moussa',
    lastName: 'Traoré',
    email: 'comptable@cabcomptable.ml',
    phone: '+22376928012',
    passwordHash,
    role: ROLES.ACCOUNTANT,
    emailVerified: true,
    status: 'active',
    companyId: null,
    preferences: { emailNotifications: true },
  });

  console.log('Seed OK — Admin: admin@cabcomptable.ml / Admin123!');
  console.log('Seed OK — Comptable: comptable@cabcomptable.ml / Admin123!');
}

module.exports = { seedIfEmpty, ROLES, STAFF_ROLES, ADMIN_ROLES };
