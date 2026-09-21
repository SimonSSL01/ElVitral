const request = require('supertest');

jest.mock('../lib/db.js', () => ({ query: jest.fn() }));
jest.mock('../lib/auth.js', () => ({
  getUserFromRequest: jest.fn(),
  isAdmin: jest.fn((user) => user?.rol === 'admin'),
  sanitizeString: jest.fn((value) => String(value ?? '').trim()),
  sanitizeEmail: jest.fn((value) => String(value ?? '').trim().toLowerCase()),
}));
jest.mock('../lib/notifications.js', () => ({
  notifyOrderCreated: jest.fn(),
  notifyOrderStateChange: jest.fn(),
  notifyAppointment: jest.fn(),
  notifyStockMovement: jest.fn(),
  notifyPaymentReceived: jest.fn(),
}));

const { query } = require('../lib/db.js');
const { getUserFromRequest } = require('../lib/auth.js');
const { notifyPaymentReceived } = require('../lib/notifications.js');
const app = require('../index.js');

describe('Pagos Stripe en COP', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_example';
    getUserFromRequest.mockReturnValue({ id: 'user-1', rol: 'usuario' });
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  test('envía $10.000 COP como 1.000.000 unidades menores de Stripe', async () => {
    query.mockResolvedValueOnce([{
      id: 31,
      usuario_id: 'user-1',
      total: 10000,
      pago: 'pendiente',
      estado: 'pendiente',
    }]);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'cs_test_123', url: 'https://checkout.stripe.test/session' }),
    });

    const response = await request(app)
      .post('/api/pedidos/31/create-checkout-session')
      .send({ tipo_pago: 'pagado' });

    expect(response.status).toBe(200);
    const body = new URLSearchParams(global.fetch.mock.calls[0][1].body);
    expect(body.get('line_items[0][price_data][currency]')).toBe('cop');
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('1000000');
    expect(global.fetch.mock.calls[0][1].headers['Idempotency-Key']).toMatch(/^pedido-31-pendiente-pagado-/);
    expect(response.body.amount_cop).toBe(10000);
  });

  test('crea la sesión de anticipo por el 50% del pedido', async () => {
    query.mockResolvedValueOnce([{
      id: 31,
      usuario_id: 'user-1',
      total: 10000,
      pago: 'pendiente',
      estado: 'pendiente',
    }]);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'cs_test_anticipo', url: 'https://checkout.stripe.test/anticipo' }),
    });

    const response = await request(app)
      .post('/api/pedidos/31/create-checkout-session')
      .send({ tipo_pago: 'anticipo' });

    expect(response.status).toBe(200);
    const body = new URLSearchParams(global.fetch.mock.calls[0][1].body);
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('500000');
    expect(body.get('metadata[tipo_pago]')).toBe('anticipo');
    expect(global.fetch.mock.calls[0][1].headers['Idempotency-Key']).toMatch(/^pedido-31-pendiente-anticipo-/);
    expect(response.body.amount_cop).toBe(5000);
  });

  test('rechaza cotizaciones por debajo de $10.000 COP', async () => {
    query.mockResolvedValueOnce([{
      id: 7,
      nombre: 'Herraje pequeño',
      tipo: 'herraje',
      precio_base: 9000,
    }]);

    const response = await request(app)
      .post('/api/cotizaciones')
      .send({
        cliente: {
          nombre: 'Cliente prueba',
          email: 'cliente@example.com',
          telefono: '3001234567',
          direccion: 'Calle 1',
        },
        productos: [{ producto_id: 7, cantidad: 1 }],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('$10.000 COP');
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('confirma el pago, inicia el pedido y avisa a los administradores', async () => {
    const pedido = {
      id: 31,
      usuario_id: 'user-1',
      total: 10000,
      pago: 'pendiente',
      estado: 'pendiente',
    };
    query
      .mockResolvedValueOnce([pedido])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([{ email: 'admin@example.com' }]);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        payment_status: 'paid',
        currency: 'cop',
        amount_total: 1000000,
        metadata: { pedido_id: '31', tipo_pago: 'pagado', pago_previo: 'pendiente' },
        payment_intent: { status: 'succeeded', amount: 1000000 },
      }),
    });

    const response = await request(app)
      .post('/api/pedidos/31/pago-completado')
      .send({ stripe_session_id: 'cs_test_123', tipo_pago: 'pagado' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ pago: 'pagado', estado: 'en_proceso' });
    expect(query).toHaveBeenCalledWith(
      'UPDATE pedidos SET pago = ?, estado = ? WHERE id = ?',
      ['pagado', 'en_proceso', 31]
    );
    expect(notifyPaymentReceived).toHaveBeenCalledWith(
      ['admin@example.com'],
      31,
      10000,
      false
    );
  });

  test('confirma un anticipo y deja el pedido en estado de anticipo', async () => {
    const pedido = {
      id: 31,
      usuario_id: 'user-1',
      total: 10000,
      pago: 'pendiente',
      estado: 'pendiente',
    };
    query
      .mockResolvedValueOnce([pedido])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([{ email: 'admin@example.com' }]);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        payment_status: 'paid',
        currency: 'cop',
        amount_total: 500000,
        metadata: { pedido_id: '31', tipo_pago: 'anticipo', pago_previo: 'pendiente' },
        payment_intent: { status: 'succeeded', amount: 500000 },
      }),
    });

    const response = await request(app)
      .post('/api/pedidos/31/pago-completado')
      .send({ stripe_session_id: 'cs_test_anticipo', tipo_pago: 'anticipo' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ pago: 'anticipo', estado: 'en_proceso' });
    expect(notifyPaymentReceived).toHaveBeenCalledWith(
      ['admin@example.com'],
      31,
      5000,
      true
    );
  });

  describe('Caso 1: Usuario no autenticado', () => {
    test('no permite crear sesión de checkout si el usuario no está autenticado (401)', async () => {
      getUserFromRequest.mockReturnValueOnce(null);

      const response = await request(app)
        .post('/api/pedidos/31/create-checkout-session')
        .send({ tipo_pago: 'pagado' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('No autorizado');
      expect(global.fetch).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    });

    test('no permite confirmar pago si el usuario no está autenticado (401)', async () => {
      getUserFromRequest.mockReturnValueOnce(null);

      const response = await request(app)
        .post('/api/pedidos/31/pago-completado')
        .send({ stripe_session_id: 'cs_test_123', tipo_pago: 'pagado' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('No autorizado');
      expect(global.fetch).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('Caso 2: Usuario no es dueño del pedido (403)', () => {
    test('rechaza crear sesión de pago si el usuario no es el dueño ni admin', async () => {
      getUserFromRequest.mockReturnValue({ id: 'user-impostor', rol: 'usuario' });
      query.mockResolvedValueOnce([{
        id: 31,
        usuario_id: 'user-1',
        total: 10000,
        pago: 'pendiente',
        estado: 'pendiente',
      }]);

      const response = await request(app)
        .post('/api/pedidos/31/create-checkout-session')
        .send({ tipo_pago: 'pagado' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('No autorizado');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('rechaza confirmar pago si el usuario no es el dueño ni admin', async () => {
      getUserFromRequest.mockReturnValue({ id: 'user-impostor', rol: 'usuario' });
      query.mockResolvedValueOnce([{
        id: 31,
        usuario_id: 'user-1',
        total: 10000,
        pago: 'pendiente',
        estado: 'pendiente',
      }]);

      const response = await request(app)
        .post('/api/pedidos/31/pago-completado')
        .send({ stripe_session_id: 'cs_test_123', tipo_pago: 'pagado' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('No autorizado');
      expect(global.fetch).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE pedidos'), expect.anything());
    });
  });

  describe('Caso 3: Sesión Stripe no aprobada', () => {
    test('rechaza confirmación si el estado de pago no es paid ni payment_intent succeeded (400)', async () => {
      query.mockResolvedValueOnce([{
        id: 31,
        usuario_id: 'user-1',
        total: 10000,
        pago: 'pendiente',
        estado: 'pendiente',
      }]);
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          payment_status: 'unpaid',
          currency: 'cop',
          amount_total: 1000000,
          metadata: { pedido_id: '31', tipo_pago: 'pagado', pago_previo: 'pendiente' },
          payment_intent: { status: 'requires_payment_method' },
        }),
      });

      const response = await request(app)
        .post('/api/pedidos/31/pago-completado')
        .send({ stripe_session_id: 'cs_test_unpaid', tipo_pago: 'pagado' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('La transacción no está aprobada');
      expect(query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE pedidos'), expect.anything());
    });
  });

  describe('Caso 4: Metadatos no coinciden con el pedido', () => {
    const basePedido = {
      id: 31,
      usuario_id: 'user-1',
      total: 10000,
      pago: 'pendiente',
      estado: 'pendiente',
    };

    test('rechaza si pedido_id en metadata no coincide (400)', async () => {
      query.mockResolvedValueOnce([basePedido]);
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          payment_status: 'paid',
          currency: 'cop',
          amount_total: 1000000,
          metadata: { pedido_id: '99', tipo_pago: 'pagado', pago_previo: 'pendiente' },
        }),
      });

      const response = await request(app)
        .post('/api/pedidos/31/pago-completado')
        .send({ stripe_session_id: 'cs_test_wrong_pedido', tipo_pago: 'pagado' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('La sesión de pago no corresponde a este pedido');
      expect(query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE pedidos'), expect.anything());
    });

    test('rechaza si tipo_pago en metadata no coincide (400)', async () => {
      query.mockResolvedValueOnce([basePedido]);
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          payment_status: 'paid',
          currency: 'cop',
          amount_total: 1000000,
          metadata: { pedido_id: '31', tipo_pago: 'anticipo', pago_previo: 'pendiente' },
        }),
      });

      const response = await request(app)
        .post('/api/pedidos/31/pago-completado')
        .send({ stripe_session_id: 'cs_test_wrong_tipo', tipo_pago: 'pagado' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('La sesión de pago no corresponde a este pedido');
      expect(query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE pedidos'), expect.anything());
    });

    test('rechaza si pago_previo en metadata no coincide con el estado del pedido (400)', async () => {
      query.mockResolvedValueOnce([basePedido]);
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          payment_status: 'paid',
          currency: 'cop',
          amount_total: 1000000,
          metadata: { pedido_id: '31', tipo_pago: 'pagado', pago_previo: 'anticipo' },
        }),
      });

      const response = await request(app)
        .post('/api/pedidos/31/pago-completado')
        .send({ stripe_session_id: 'cs_test_wrong_previo', tipo_pago: 'pagado' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('La sesión de pago no corresponde a este pedido');
      expect(query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE pedidos'), expect.anything());
    });
  });

  describe('Caso 5: Discrepancia en el monto recibido', () => {
    test('rechaza confirmación si el monto recibido es diferente al esperado (400)', async () => {
      query.mockResolvedValueOnce([{
        id: 31,
        usuario_id: 'user-1',
        total: 10000,
        pago: 'pendiente',
        estado: 'pendiente',
      }]);
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          payment_status: 'paid',
          currency: 'cop',
          amount_total: 500000,
          metadata: { pedido_id: '31', tipo_pago: 'pagado', pago_previo: 'pendiente' },
        }),
      });

      const response = await request(app)
        .post('/api/pedidos/31/pago-completado')
        .send({ stripe_session_id: 'cs_test_wrong_amount', tipo_pago: 'pagado' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('El monto recibido no corresponde al pago del pedido');
      expect(query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE pedidos'), expect.anything());
    });
  });

  describe('Caso 6: Pedido ya pagado', () => {
    test('rechaza confirmación si el pedido ya tiene pago pagado (400)', async () => {
      query.mockResolvedValueOnce([{
        id: 31,
        usuario_id: 'user-1',
        total: 10000,
        pago: 'pagado',
        estado: 'en_proceso',
      }]);

      const response = await request(app)
        .post('/api/pedidos/31/pago-completado')
        .send({ stripe_session_id: 'cs_test_already_paid', tipo_pago: 'pagado' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('El pedido ya se encuentra totalmente pagado');
      expect(global.fetch).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE pedidos'), expect.anything());
    });
  });

  describe('Caso 7: Errores controlados de Stripe sin fuga de datos sensibles', () => {
    test('responde error controlado sin exponer claves si Stripe falla al crear sesión', async () => {
      query.mockResolvedValueOnce([{
        id: 31,
        usuario_id: 'user-1',
        total: 10000,
        pago: 'pendiente',
        estado: 'pendiente',
      }]);
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: 'Invalid API Key provided: sk_test_example_secret',
            type: 'invalid_request_error',
          },
        }),
      });

      const response = await request(app)
        .post('/api/pedidos/31/create-checkout-session')
        .send({ tipo_pago: 'pagado' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(JSON.stringify(response.body)).not.toContain('sk_test_example_secret');
    });

    test('responde error controlado si la llamada de red a Stripe falla al crear sesión', async () => {
      query.mockResolvedValueOnce([{
        id: 31,
        usuario_id: 'user-1',
        total: 10000,
        pago: 'pendiente',
        estado: 'pendiente',
      }]);
      global.fetch.mockRejectedValueOnce(new Error('Connection refused'));

      const response = await request(app)
        .post('/api/pedidos/31/create-checkout-session')
        .send({ tipo_pago: 'pagado' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Error creando la sesión de Stripe');
      expect(JSON.stringify(response.body)).not.toContain('sk_test');
    });

    test('responde error controlado sin exponer claves si Stripe falla al verificar sesión', async () => {
      query.mockResolvedValueOnce([{
        id: 31,
        usuario_id: 'user-1',
        total: 10000,
        pago: 'pendiente',
        estado: 'pendiente',
      }]);
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => '{"error": {"message": "No such checkout.session: cs_test_notfound with key sk_test_example_secret"}}',
      });

      const response = await request(app)
        .post('/api/pedidos/31/pago-completado')
        .send({ stripe_session_id: 'cs_test_notfound', tipo_pago: 'pagado' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No se pudo verificar la sesión de Stripe');
      expect(JSON.stringify(response.body)).not.toContain('sk_test_example_secret');
      expect(query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE pedidos'), expect.anything());
    });

    test('responde error controlado si la llamada de red a Stripe falla al verificar sesión', async () => {
      query.mockResolvedValueOnce([{
        id: 31,
        usuario_id: 'user-1',
        total: 10000,
        pago: 'pendiente',
        estado: 'pendiente',
      }]);
      global.fetch.mockRejectedValueOnce(new Error('Stripe timeout'));

      const response = await request(app)
        .post('/api/pedidos/31/pago-completado')
        .send({ stripe_session_id: 'cs_test_timeout', tipo_pago: 'pagado' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Fallo al procesar verificación Stripe');
      expect(JSON.stringify(response.body)).not.toContain('sk_test');
      expect(query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE pedidos'), expect.anything());
    });
  });
});
