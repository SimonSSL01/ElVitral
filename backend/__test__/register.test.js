const request = require('supertest');
const dns = require('dns');

jest.mock('dns', () => ({
  promises: {
    resolveMx: jest.fn(),
  },
}));

jest.mock('../lib/db.js', () => ({
  query: jest.fn(),
}));

jest.mock('../lib/auth.js', () => ({
  hashPassword: jest.fn(() => Promise.resolve('hashed_password')),
  comparePassword: jest.fn(),
  sanitizeEmail: jest.fn((email) => String(email ?? '').trim().toLowerCase()),
  sanitizeString: jest.fn((value) => String(value ?? '').trim()),
  generateToken: jest.fn(),
  getUserFromRequest: jest.fn(),
  isAdmin: jest.fn((user) => user?.rol === 'admin'),
  verifyToken: jest.fn(),
}));

const { query } = require('../lib/db.js');
const { hashPassword, sanitizeEmail, sanitizeString } = require('../lib/auth.js');
const app = require('../index.js');

describe('Registro - POST /api/auth/register', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dns.promises.resolveMx.mockResolvedValue([{ exchange: 'mail.test.com', priority: 10 }]);
  });

  test('registra un usuario nuevo correctamente', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 1 });

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        nombre: 'Maria Lopez',
        email: 'maria@test.com',
        password: '123456',
        telefono: '3001234567',
        direccion: 'Calle 1',
        aceptaPoliticaDatos: true,
        aceptaTerminos: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Usuario registrado correctamente');
    expect(hashPassword).toHaveBeenCalledWith('123456');
    expect(query.mock.calls[1][0]).toContain('INSERT INTO usuarios');
  });

  test('rechaza registro si faltan campos obligatorios', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        nombre: '',
        email: 'maria@test.com',
        password: '',
      });

    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  test('rechaza registro si no se aceptan las políticas legales', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        nombre: 'Maria Lopez',
        email: 'maria@test.com',
        password: '123456',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Debes aceptar la política de tratamiento de datos y los términos y condiciones');
    expect(query).not.toHaveBeenCalled();
  });

  test('rechaza registro si el correo ya existe', async () => {
    query.mockResolvedValueOnce([{ id: 1 }]);

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        nombre: 'Maria Lopez',
        email: 'maria@test.com',
        password: '123456',
        aceptaPoliticaDatos: true,
        aceptaTerminos: true,
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('El correo ya está registrado');
    expect(dns.promises.resolveMx).not.toHaveBeenCalled();
  });

  test('rechaza registro cuando el correo contiene espacios y ya existe después de sanitizarse', async () => {
    query.mockResolvedValueOnce([{ id: 5 }]);

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        nombre: 'Maria Lopez',
        email: '   MARIA@test.com   ',
        password: '123456',
        telefono: '3001234567',
        direccion: 'Calle 1',
        aceptaPoliticaDatos: true,
        aceptaTerminos: true,
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();

    expect(query).toHaveBeenCalledTimes(1);
    expect(hashPassword).not.toHaveBeenCalled();
  });

  // ==========================
  // TEST 35 (NUEVO)
  // ==========================
  test('sanitiza correctamente nombre y correo antes del registro', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 15 });

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        nombre: '   Maria Lopez   ',
        email: '   MARIA@TEST.COM   ',
        password: '123456',
        telefono: '3001234567',
        direccion: 'Calle 1',
        aceptaPoliticaDatos: true,
        aceptaTerminos: true,
      });

    expect(res.status).toBe(201);

    expect(sanitizeString).toHaveBeenCalledWith('   Maria Lopez   ');
    expect(sanitizeEmail).toHaveBeenCalledWith('   MARIA@TEST.COM   ');
    expect(hashPassword).toHaveBeenCalledWith('123456');
  });

  test('rechaza registro si el dominio no tiene registros MX', async () => {
    dns.promises.resolveMx.mockResolvedValueOnce([]);

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        nombre: 'Maria Lopez',
        email: 'maria@sinmx.com',
        password: '123456',
        aceptaPoliticaDatos: true,
        aceptaTerminos: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('El dominio del correo no es válido (no recibe correos)');
    expect(query).toHaveBeenCalledWith(
      'SELECT id FROM usuarios WHERE email = ?',
      ['maria@sinmx.com']
    );
  });

  test('rechaza registro si la resolución DNS del dominio arroja error', async () => {
    dns.promises.resolveMx.mockRejectedValueOnce(new Error('queryMx ENOTFOUND'));

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        nombre: 'Maria Lopez',
        email: 'maria@invalido.com',
        password: '123456',
        aceptaPoliticaDatos: true,
        aceptaTerminos: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('El dominio del correo no existe o no es válido');
    expect(query).toHaveBeenCalledWith(
      'SELECT id FROM usuarios WHERE email = ?',
      ['maria@invalido.com']
    );
  });
  test('rechaza registro si el correo no tiene @', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        nombre: 'Maria Lopez',
        email: 'correosinseparador.com',
        password: '123456',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(dns.promises.resolveMx).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  test('rechaza registro si el correo no tiene dominio o formato válido', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        nombre: 'Maria Lopez',
        email: 'usuario@',
        password: '123456',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(dns.promises.resolveMx).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  test('rechaza registro si la contraseña tiene menos de 6 caracteres', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        nombre: 'Maria Lopez',
        email: 'maria@test.com',
        password: '12345',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(dns.promises.resolveMx).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  test('rechaza registro si el nombre está formado únicamente por espacios', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        nombre: '    ',
        email: 'maria@test.com',
        password: '123456',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(dns.promises.resolveMx).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  test('permite registro con contraseña de exactamente 6 caracteres conservando validación MX', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 10 });

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        nombre: 'Maria Lopez',
        email: 'maria@test.com',
        password: 'abcdef',
        aceptaPoliticaDatos: true,
        aceptaTerminos: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Usuario registrado correctamente');
    expect(dns.promises.resolveMx).toHaveBeenCalledWith('test.com');
    expect(hashPassword).toHaveBeenCalledWith('abcdef');
    expect(query).toHaveBeenCalledTimes(2);
  });
});
