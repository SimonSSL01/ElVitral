const request = require('supertest');

jest.mock('../lib/db.js', () => ({
  query: jest.fn(),
}));

jest.mock('../lib/auth.js', () => ({
  hashPassword: jest.fn(),
  comparePassword: jest.fn(),
  sanitizeEmail: jest.fn((email) => String(email ?? '').trim().toLowerCase()),
  sanitizeString: jest.fn((value) => String(value ?? '').trim()),
  generateAccessToken: jest.fn(() => 'fake-access-token'),
  generateRefreshToken: jest.fn(() => 'fake-refresh-token'),
  getUserFromRequest: jest.fn(),
  isAdmin: jest.fn((user) => user?.rol === 'admin'),
  verifyToken: jest.fn(),
  verifyAccessToken: jest.fn(),
  verifyRefreshToken: jest.fn(),
  createSession: jest.fn(() => ({ sid: 'fake-sid', session: {} })),
  deleteSession: jest.fn(),
  getSession: jest.fn(),
}));

const { query } = require('../lib/db.js');
const {
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  createSession,
  sanitizeEmail,
} = require('../lib/auth.js');

const app = require('../index.js');

describe('Login - POST /api/auth/login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('inicia sesion correctamente con credenciales validas', async () => {
    query.mockResolvedValueOnce([
      {
        id: 1,
        nombre: 'Juan Perez',
        email: 'juan@test.com',
        password: 'hashed_password',
        rol: 'usuario',
        activo: 1,
        aprobado: 1,
      },
    ]);

    comparePassword.mockResolvedValueOnce(true);

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'juan@test.com',
        password: '123456',
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();

    expect(createSession).toHaveBeenCalledWith({
      id: 1,
      rol: 'usuario',
      nombre: 'Juan Perez',
      email: 'juan@test.com',
    });

    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.body.token).toBeUndefined();
  });

  test('rechaza login con password incorrecto', async () => {
    query.mockResolvedValueOnce([
      {
        id: 1,
        nombre: 'Juan Perez',
        email: 'juan@test.com',
        password: 'hashed_password',
        rol: 'usuario',
        activo: 1,
        aprobado: 1,
      },
    ]);

    comparePassword.mockResolvedValueOnce(false);

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'juan@test.com',
        password: 'incorrecta',
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  test('rechaza login si el usuario no existe', async () => {
    query.mockResolvedValueOnce([]);

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'noexiste@test.com',
        password: '123456',
      });

    expect(res.status).toBe(401);
    expect(comparePassword).not.toHaveBeenCalled();
  });
  
  test('rechaza login cuando email y password estan vacios', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: '',
        password: '',
      });

    expect(sanitizeEmail).toHaveBeenCalledWith('');

    expect(res.status).toBe(400);

    expect(query).not.toHaveBeenCalled();

    expect(comparePassword).not.toHaveBeenCalled();

    expect(generateAccessToken).not.toHaveBeenCalled();
    expect(generateRefreshToken).not.toHaveBeenCalled();
  });

  test('maneja JSON inválido de forma segura sin registrar información sensible', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const secretPassword = 'super-secret-password-12345';
    const secretCookie = 'token=secret-session-cookie';
    const secretAuth = 'Bearer secret-jwt-token-xyz';

    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('Cookie', secretCookie)
      .set('Authorization', secretAuth)
      .send(`{"email": "juan@test.com", "password": "${secretPassword}", broken`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Formato JSON inválido');

    expect(consoleErrorSpy).toHaveBeenCalled();

    for (const callArgs of consoleErrorSpy.mock.calls) {
      const loggedContent = callArgs
        .map((arg) => (typeof arg === 'object' && arg !== null ? JSON.stringify(arg) : String(arg)))
        .join(' ');

      expect(loggedContent).not.toContain(secretPassword);
      expect(loggedContent).not.toContain(secretCookie);
      expect(loggedContent).not.toContain(secretAuth);
      expect(loggedContent).not.toContain('broken');
    }

    const invalidJsonCall = consoleErrorSpy.mock.calls.find((call) =>
      call.some((arg) => typeof arg === 'string' && arg.includes('Invalid JSON body received'))
    );
    expect(invalidJsonCall).toBeDefined();

    const safeMeta = invalidJsonCall.find((arg) => typeof arg === 'object' && arg !== null);
    expect(safeMeta).toMatchObject({
      method: 'POST',
      url: '/api/auth/login',
      contentType: 'application/json',
      error: 'SyntaxError',
    });
    expect(safeMeta.contentLength).toBeGreaterThan(0);

    consoleErrorSpy.mockRestore();
  });
});
const {
  getUserFromRequest,
  getSession,
  deleteSession,
  createSession: createSessionImport,
} = require('../lib/auth.js');

// ─────────────────────────────────────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────────────────────────────────────
describe('Logout - POST /api/auth/logout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('invalida la sesión y devuelve 200 con cookie limpia', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', 'sid=fake-sid');

    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();

    // Debe llamarse deleteSession con el sid
    expect(deleteSession).toHaveBeenCalledWith('fake-sid');

    // La cookie de sesión debe quedar invalidada en la respuesta
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const sidCookie = cookies.find((c) => c.startsWith('sid='));
    expect(sidCookie).toBeDefined();
    expect(sidCookie).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });

  test('logout sin cookie devuelve 200 y no llama deleteSession', async () => {
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(deleteSession).not.toHaveBeenCalled();
  });

  test('la respuesta de logout no expone tokens ni datos de sesión', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', 'sid=fake-sid');

    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
    expect(res.body.sid).toBeUndefined();
    expect(res.body.password).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REFRESH
// ─────────────────────────────────────────────────────────────────────────────
describe('Refresh - POST /api/auth/refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('sin cookie de sesión devuelve HTTP 401', async () => {
    getSession.mockReturnValue(null);

    const res = await request(app).post('/api/auth/refresh');

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
    expect(query).not.toHaveBeenCalled();
  });

  test('con sid inválido o inexistente en store devuelve HTTP 401', async () => {
    getSession.mockReturnValue(null);

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'sid=sesion-que-no-existe');

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  test('usuario desactivado no puede renovar sesión: HTTP 403', async () => {
    getSession.mockReturnValue({ userId: 99 });
    query.mockResolvedValueOnce([
      { id: 99, rol: 'usuario', nombre: 'Inactivo', email: 'i@test.com', activo: 0, aprobado: 1 },
    ]);

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'sid=valid-sid');

    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
    // No debe crear nueva sesión
    expect(createSessionImport).not.toHaveBeenCalled();
  });

  test('usuario pendiente de aprobación no puede renovar sesión: HTTP 403', async () => {
    getSession.mockReturnValue({ userId: 88 });
    query.mockResolvedValueOnce([
      { id: 88, rol: 'usuario', nombre: 'Pendiente', email: 'p@test.com', activo: 1, aprobado: 0 },
    ]);

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'sid=valid-sid');

    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
    expect(createSessionImport).not.toHaveBeenCalled();
  });

  test('flujo válido de refresh renueva sesión y responde 200 sin exponer contraseña', async () => {
    getSession.mockReturnValue({ userId: 1 });
    query.mockResolvedValueOnce([
      { id: 1, rol: 'usuario', nombre: 'Juan', email: 'juan@test.com', activo: 1, aprobado: 1 },
    ]);
    createSessionImport.mockReturnValue({ sid: 'new-sid' });

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'sid=old-sid');

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe('juan@test.com');

    // No debe exponer contraseña ni tokens en body
    expect(res.body.password).toBeUndefined();
    expect(res.body.token).toBeUndefined();

    // Debe emitir nueva cookie de sesión
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me — estado de cuenta
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/auth/me - estado de cuenta', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getUserFromRequest.mockReturnValue({ id: 1, rol: 'usuario' });
  });

  test('usuario activo y aprobado obtiene su perfil (200)', async () => {
    query.mockResolvedValueOnce([
      { id: 1, nombre: 'Juan', email: 'juan@test.com', rol: 'usuario', activo: 1, aprobado: 1 },
    ]);

    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('juan@test.com');
    // No debe exponer contraseña
    expect(res.body.password).toBeUndefined();
  });

  test('usuario desactivado recibe HTTP 403 en /api/auth/me', async () => {
    query.mockResolvedValueOnce([
      { id: 1, nombre: 'Juan', email: 'juan@test.com', rol: 'usuario', activo: 0, aprobado: 1 },
    ]);

    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
  });

  test('usuario no aprobado recibe HTTP 403 en /api/auth/me', async () => {
    query.mockResolvedValueOnce([
      { id: 1, nombre: 'Juan', email: 'juan@test.com', rol: 'usuario', activo: 1, aprobado: 0 },
    ]);

    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
  });

  test('sin token devuelve 401 en /api/auth/me', async () => {
    getUserFromRequest.mockReturnValue(null);

    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
});
