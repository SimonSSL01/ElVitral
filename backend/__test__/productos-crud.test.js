const request = require('supertest');

jest.mock('../lib/db.js', () => ({
  query: jest.fn(),
}));

jest.mock('../lib/auth.js', () => ({
  hashPassword: jest.fn(),
  comparePassword: jest.fn(),
  sanitizeEmail: jest.fn((email) => String(email ?? '').trim().toLowerCase()),
  sanitizeString: jest.fn((value) => String(value ?? '').trim()),
  generateToken: jest.fn(),

  getUserFromRequest: jest.fn(),

  isAdmin: jest.fn((user) => user?.rol === 'admin'),

  requireAdmin: jest.fn(() => ({
    ok: true,
    user: {
      id: 1,
      rol: 'admin',
    },
  })),

  verifyToken: jest.fn(),
}));

const { query } = require('../lib/db.js');

const {
  getUserFromRequest,
  requireAdmin,
} = require('../lib/auth.js');

const app = require('../index.js');

describe('CRUD Productos - /api/admin/productos', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    getUserFromRequest.mockReturnValue({
      id: 1,
      rol: 'admin',
    });

    requireAdmin.mockReturnValue({
      ok: true,
      user: {
        id: 1,
        rol: 'admin',
      },
    });
  });

  // ─── Casos válidos existentes ─────────────────────────────────────────────

  test('crea un producto correctamente', async () => {
    query.mockResolvedValueOnce({ insertId: 10 });

    const res = await request(app)
      .post('/api/admin/productos')
      .send({
        nombre: 'Vidrio templado',
        descripcion: 'Vidrio de seguridad',
        tipo: 'vidrio',
        unidad_medida: 'm2',
        precio_base: 120000,
        imagen_url: '',
        stock: 5,
        activo: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Producto creado');
    expect(res.body.id).toBe(10);
    expect(query.mock.calls[0][0]).toContain('INSERT INTO productos');
  });

  test('actualiza un producto correctamente', async () => {
    // Primera query: verificar existencia; segunda: UPDATE
    query
      .mockResolvedValueOnce([{ id: 10 }])
      .mockResolvedValueOnce({});

    const res = await request(app)
      .patch('/api/admin/productos/10')
      .send({
        nombre: 'Vidrio actualizado',
        precio_base: 150000,
        stock: 8,
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Producto actualizado');
    expect(query.mock.calls[1][0]).toContain('UPDATE productos SET');
  });

  test('elimina un producto correctamente', async () => {
    // Primera query: verificar existencia; segunda: DELETE
    query
      .mockResolvedValueOnce([{ id: 10 }])
      .mockResolvedValueOnce({});

    const res = await request(app)
      .delete('/api/admin/productos/10');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Producto eliminado');

    expect(query).toHaveBeenCalledWith(
      'DELETE FROM productos WHERE id = ?',
      [10]
    );
  });

  test('rechaza crear producto con campos incompletos', async () => {
    const res = await request(app)
      .post('/api/admin/productos')
      .send({
        nombre: '',
        tipo: '',
        unidad_medida: '',
        precio_base: 0,
      });

    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  // ─── Precio inválido ──────────────────────────────────────────────────────

  test('rechaza crear producto con precio negativo', async () => {
    const res = await request(app)
      .post('/api/admin/productos')
      .send({
        nombre: 'Vidrio',
        tipo: 'vidrio',
        unidad_medida: 'm2',
        precio_base: -500,
        stock: 5,
        activo: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(query).not.toHaveBeenCalled();
  });

  test('rechaza crear producto con precio cero', async () => {
    const res = await request(app)
      .post('/api/admin/productos')
      .send({
        nombre: 'Vidrio',
        tipo: 'vidrio',
        unidad_medida: 'm2',
        precio_base: 0,
        stock: 5,
        activo: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(query).not.toHaveBeenCalled();
  });

  test('rechaza crear producto con precio no numérico', async () => {
    const res = await request(app)
      .post('/api/admin/productos')
      .send({
        nombre: 'Vidrio',
        tipo: 'vidrio',
        unidad_medida: 'm2',
        precio_base: 'abc',
        stock: 5,
        activo: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(query).not.toHaveBeenCalled();
  });

  // ─── Stock inválido ───────────────────────────────────────────────────────

  test('rechaza crear producto con stock negativo', async () => {
    const res = await request(app)
      .post('/api/admin/productos')
      .send({
        nombre: 'Vidrio',
        tipo: 'vidrio',
        unidad_medida: 'm2',
        precio_base: 100000,
        stock: -3,
        activo: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(query).not.toHaveBeenCalled();
  });

  test('rechaza crear producto con stock no numérico', async () => {
    const res = await request(app)
      .post('/api/admin/productos')
      .send({
        nombre: 'Vidrio',
        tipo: 'vidrio',
        unidad_medida: 'm2',
        precio_base: 100000,
        stock: 'mucho',
        activo: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(query).not.toHaveBeenCalled();
  });

  // ─── Producto inexistente ─────────────────────────────────────────────────

  test('devuelve 404 al actualizar un producto inexistente', async () => {
    query.mockResolvedValueOnce([]); // ningún producto encontrado

    const res = await request(app)
      .patch('/api/admin/productos/9999')
      .send({ nombre: 'Nuevo nombre' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  test('devuelve 404 al eliminar un producto inexistente', async () => {
    query.mockResolvedValueOnce([]); // ningún producto encontrado

    const res = await request(app)
      .delete('/api/admin/productos/9999');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  // ─── No administrador ─────────────────────────────────────────────────────

  test('usuario no admin no puede crear productos (403)', async () => {
    requireAdmin.mockReturnValueOnce({
      ok: false,
      status: 403,
      error: 'Acceso denegado',
    });

    const res = await request(app)
      .post('/api/admin/productos')
      .send({
        nombre: 'Vidrio',
        tipo: 'vidrio',
        unidad_medida: 'm2',
        precio_base: 100000,
        stock: 5,
        activo: true,
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
    expect(query).not.toHaveBeenCalled();
  });

  test('usuario no admin no puede actualizar productos (403)', async () => {
    requireAdmin.mockReturnValueOnce({
      ok: false,
      status: 403,
      error: 'Acceso denegado',
    });

    const res = await request(app)
      .patch('/api/admin/productos/10')
      .send({ nombre: 'Hack' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
    expect(query).not.toHaveBeenCalled();
  });

  test('usuario no admin no puede eliminar productos (403)', async () => {
    requireAdmin.mockReturnValueOnce({
      ok: false,
      status: 403,
      error: 'Acceso denegado',
    });

    const res = await request(app)
      .delete('/api/admin/productos/10');

    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
    expect(query).not.toHaveBeenCalled();
  });

  // ─── Error de base de datos ───────────────────────────────────────────────

  test('error de base de datos al crear devuelve 500 controlado', async () => {
    query.mockRejectedValueOnce(new Error('Connection lost'));

    const res = await request(app)
      .post('/api/admin/productos')
      .send({
        nombre: 'Vidrio',
        tipo: 'vidrio',
        unidad_medida: 'm2',
        precio_base: 100000,
        stock: 5,
        activo: true,
      });

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
    // No debe filtrar detalles internos del error de DB
    expect(res.body.error).not.toContain('Connection lost');
  });

  test('error de base de datos al eliminar devuelve 500 controlado', async () => {
    query
      .mockResolvedValueOnce([{ id: 10 }]) // existe el producto
      .mockRejectedValueOnce(new Error('Deadlock found'));

    const res = await request(app)
      .delete('/api/admin/productos/10');

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
    expect(res.body.error).not.toContain('Deadlock found');
  });

  // ─── JSON inválido en PATCH ───────────────────────────────────────────────

  test('PATCH con JSON inválido devuelve 400 y no ejecuta UPDATE', async () => {
    query.mockResolvedValueOnce([{ id: 10 }]); // producto existe (SELECT previo)

    const res = await request(app)
      .patch('/api/admin/productos/10')
      .set('Content-Type', 'application/json')
      .send('{esto-no-es-json}');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Formato JSON inválido');
    // No debe llamarse UPDATE
    const updateCalls = query.mock.calls.filter((c) => String(c[0]).includes('UPDATE'));
    expect(updateCalls).toHaveLength(0);
  });

  // ─── Validaciones de precio y stock en PATCH ──────────────────────────────

  test('PATCH con precio inválido devuelve 400 y no ejecuta UPDATE', async () => {
    query.mockResolvedValueOnce([{ id: 10 }]); // producto existe

    const res = await request(app)
      .patch('/api/admin/productos/10')
      .send({ precio_base: -9999 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    const updateCalls = query.mock.calls.filter((c) => String(c[0]).includes('UPDATE'));
    expect(updateCalls).toHaveLength(0);
  });

  test('PATCH con stock negativo devuelve 400 y no ejecuta UPDATE', async () => {
    query.mockResolvedValueOnce([{ id: 10 }]); // producto existe

    const res = await request(app)
      .patch('/api/admin/productos/10')
      .send({ stock: -1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    const updateCalls = query.mock.calls.filter((c) => String(c[0]).includes('UPDATE'));
    expect(updateCalls).toHaveLength(0);
  });
});

// ==========================
// TEST 37 (NUEVO)
// ==========================
describe('Pruebas adicionales de productos', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    getUserFromRequest.mockReturnValue({ id: 1, rol: 'admin' });
    requireAdmin.mockReturnValue({ ok: true, user: { id: 1, rol: 'admin' } });
  });

  test('permite crear un producto sin descripcion', async () => {
    query.mockResolvedValueOnce({ insertId: 20 });

    const res = await request(app)
      .post('/api/admin/productos')
      .send({
        nombre: 'Espejo Premium',
        descripcion: '',
        tipo: 'espejo',
        unidad_medida: 'unidad',
        precio_base: 85000,
        imagen_url: '',
        stock: 3,
        activo: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Producto creado');
    expect(res.body.id).toBe(20);
    expect(query.mock.calls[0][0]).toContain('INSERT INTO productos');
  });

  test('crea un segundo producto con datos diferentes', async () => {
    query.mockResolvedValueOnce({ insertId: 31 });

    const res = await request(app)
      .post('/api/admin/productos')
      .send({
        nombre: 'Puerta de Vidrio',
        descripcion: 'Puerta templada',
        tipo: 'puerta',
        unidad_medida: 'unidad',
        precio_base: 450000,
        imagen_url: '',
        stock: 2,
        activo: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Producto creado');
    expect(res.body.id).toBe(31);
  });
});