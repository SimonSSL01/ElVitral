const request = require('supertest');

jest.mock('../lib/db.js', () => ({
  query: jest.fn(),
}));

const { query } = require('../lib/db.js');
const app = require('../index.js');

describe('Catalogo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('lista productos activos del catalogo', async () => {
    query.mockResolvedValueOnce([
      {
        id: 1,
        nombre: 'Vidrio templado',
        tipo: 'vidrio',
        precio_base: '120000',
        activo: 1,
      },
    ]);

    const res = await request(app).get('/api/productos');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].nombre).toBe('Vidrio templado');
  });

  test('devuelve arreglo vacio si no hay productos', async () => {
    query.mockResolvedValueOnce([]);

    const res = await request(app).get('/api/productos');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
// ==========================
// NUEVO TEST
// ==========================
test('todos los productos devueltos pertenecen al catalogo activo', async () => {
  query.mockResolvedValueOnce([
    {
      id: 1,
      nombre: 'Vidrio templado',
      tipo: 'vidrio',
      precio_base: '120000',
      activo: 1,
    },
    {
      id: 2,
      nombre: 'Espejo biselado',
      tipo: 'espejo',
      precio_base: '80000',
      activo: 1,
    },
  ]);

  const res = await request(app).get('/api/productos');

  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(2);

  res.body.forEach((producto) => {
    expect(producto.activo).toBe(1);
  });
});

describe('Productos Publicos (Calculadora)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('devuelve solo productos activos con stock y sin exponer campo stock ni costos', async () => {
    query.mockResolvedValueOnce([
      {
        id: 1,
        nombre: 'Vidrio Claro 3mm',
        tipo: 'vidrio',
        descripcion: 'Vidrio transparente',
        imagen_url: 'https://example.com/img.jpg',
        unidad_medida: 'm2',
        precio_base: '35000',
      },
    ]);

    const res = await request(app).get('/api/productos/publicos');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const prod = res.body[0];
    expect(prod.id).toBe(1);
    expect(prod.nombre).toBe('Vidrio Claro 3mm');
    expect(prod.precio_base).toBe(35000);
    // Verificación estricta de privacidad: no debe existir campo stock
    expect(prod.stock).toBeUndefined();
    expect(prod.costo_interno).toBeUndefined();
    expect(prod.activo).toBeUndefined();
  });

  test('rechaza métodos no permitidos (POST, PUT, DELETE)', async () => {
    const resPost = await request(app).post('/api/productos/publicos').send({ nombre: 'Test' });
    expect(resPost.status).toBe(404);

    const resDelete = await request(app).delete('/api/productos/publicos');
    expect(resDelete.status).toBe(404);
  });
});