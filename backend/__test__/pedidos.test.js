const request = require('supertest');

jest.mock('../lib/db.js', () => ({
  query: jest.fn(),
}));

jest.mock('../lib/auth.js', () => ({
  getUserFromRequest: jest.fn(),
  isAdmin: jest.fn((user) => user?.rol === 'admin'),
  sanitizeString: jest.fn((value) => String(value ?? '').trim()),
}));

const { query } = require('../lib/db.js');
const { getUserFromRequest } = require('../lib/auth.js');

const app = require('../index.js');

describe('Pedidos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('crea pedido desde una cotizacion valida', async () => {
    getUserFromRequest.mockReturnValue({ id: 1, rol: 'usuario' });

    query
      .mockResolvedValueOnce([
        {
          id: 20,
          usuario_id: 1,
          total: 250000,
        },
      ])
      .mockResolvedValueOnce({ insertId: 99 })
      .mockResolvedValueOnce({});

    const res = await request(app)
      .post('/api/pedidos')
      .send({
        cotizacion_id: 20,
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Pedido creado');
    expect(res.body.id).toBe(99);
  });

  test('registra salidas de inventario al convertir una cotizacion en pedido', async () => {
    getUserFromRequest.mockReturnValue({ id: 'user-1', rol: 'usuario' });

    query
      .mockResolvedValueOnce([{
        id: 20,
        usuario_id: 'user-1',
        email_cliente: 'cliente@test.com',
        total: 250000,
        estado: 'vigente',
      }])
      .mockResolvedValueOnce({ insertId: 99 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([{
        producto_id: 10,
        cantidad: 2,
        descripcion: 'Vidrio templado',
      }])
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const res = await request(app)
      .post('/api/pedidos')
      .send({ cotizacion_id: 20 });

    expect(res.status).toBe(201);
    expect(query).toHaveBeenCalledWith(
      'INSERT INTO inventario (producto_id, cantidad, tipo_movimiento, descripcion, pedido_id, usuario_id) VALUES (?, ?, ?, ?, ?, ?)',
      [10, 2, 'salida', 'Salida por pedido #99: Vidrio templado', 99, 'user-1']
    );
    expect(query).toHaveBeenCalledWith(
      'UPDATE productos SET stock = stock - ? WHERE id = ?',
      [2, 10]
    );
  });

  test('rechaza pedido sin autenticacion', async () => {
    getUserFromRequest.mockReturnValue(null);

    const res = await request(app)
      .post('/api/pedidos')
      .send({
        cotizacion_id: 20,
      });

    expect(res.status).toBe(401);
  });

  test('rechaza pedido si la cotizacion pertenece a otro usuario', async () => {
    getUserFromRequest.mockReturnValue({ id: 1, rol: 'usuario' });

    query.mockResolvedValueOnce([
      {
        id: 20,
        usuario_id: 2,
        total: 250000,
      },
    ]);

    const res = await request(app)
      .post('/api/pedidos')
      .send({
        cotizacion_id: 20,
      });

    expect(res.status).toBe(403);
  });

  test('permite responder una encuesta al usuario dueño de un pedido con UUID', async () => {
    const usuarioId = '95f90fbd-1bb9-4214-af3b-67b982b5b291';
    getUserFromRequest.mockReturnValue({ id: usuarioId, rol: 'usuario' });

    query
      .mockResolvedValueOnce([{ id: 23, usuario_id: usuarioId, estado: 'entregado' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 14 });

    const res = await request(app)
      .post('/api/encuestas')
      .send({ pedido_id: 23, calificacion: 5, comentario: 'Excelente servicio' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      message: 'Encuesta registrada correctamente',
      id: 14,
    });
    expect(query).toHaveBeenLastCalledWith(
      'INSERT INTO encuestas_satisfaccion (pedido_id, usuario_id, calificacion, comentario) VALUES (?, ?, ?, ?)',
      [23, usuarioId, 5, 'Excelente servicio']
    );
  });

  // ==========================
  // NUEVO TEST
  // ==========================
  test('rechaza crear pedido cuando la cotizacion no existe', async () => {
    getUserFromRequest.mockReturnValue({
      id: 1,
      rol: 'usuario',
    });

    query.mockResolvedValueOnce([]);

    const res = await request(app)
      .post('/api/pedidos')
      .send({
        cotizacion_id: 9999,
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();

    expect(query).toHaveBeenCalledWith(
      'SELECT * FROM cotizaciones WHERE id = ?',
      [9999]
    );
  });
});
