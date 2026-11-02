// Acesso ao Supabase usado por todos os módulos do painel.
const { supabaseUrl, supabaseKey } = window.ATUAL_CONFIG;

export const sb = window.supabase.createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'atual-admin-auth' },
});

// Códigos de erro de negócio lançados pelas funções do banco → mensagens para a equipe
const BIZ = {
  FORBIDDEN: 'Você não tem permissão para esta ação.',
  ORDER_NOT_FOUND: 'Pedido não encontrado.',
  CANCEL_REASON_REQUIRED: 'Informe o motivo do cancelamento.',
  EMPTY_NOTE: 'Escreva a observação.',
  INVALID_PAYMENT_STATUS: 'Status de pagamento inválido.',
  STORE_NOT_FOUND: 'Loja não encontrada.',
  OUT_OF_STOCK: 'Produto sem estoque suficiente.',
  PRODUCT_UNAVAILABLE: 'Produto indisponível.',
};

const PG = {
  '23505': 'Já existe um registro com esses dados (valor duplicado).',
  '23503': 'Este registro está ligado a outros dados e não pode ser alterado assim.',
  '23514': 'Algum valor está fora do permitido.',
  '42501': 'Você não tem permissão para esta ação.',
  PGRST116: 'Registro não encontrado.',
};

export function friendlyError(err) {
  if (!err) return 'Erro inesperado.';
  if (typeof err === 'string') return err;
  const msg = err.message || '';
  if (BIZ[msg]) return err.details ? `${BIZ[msg]} ${err.details}`.trim() : BIZ[msg];
  if (err.code && PG[err.code]) {
    if (err.code === '23505' && /slug/.test(msg)) return 'Já existe um item com este endereço (slug) nesta loja.';
    if (err.code === '23505' && /code/.test(msg)) return 'Já existe um cupom com este código.';
    return PG[err.code];
  }
  if (/row-level security/i.test(msg)) return 'Você não tem permissão para esta ação.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Sem conexão com o servidor. Verifique a internet.';
  if (/JWT|session/i.test(msg)) return 'Sua sessão expirou. Entre novamente.';
  return msg || 'Erro inesperado.';
}

export class ApiError extends Error {
  constructor(err) {
    super(friendlyError(err));
    this.raw = err;
  }
}

// Lança ApiError em caso de erro; devolve data.
export async function q(promise) {
  const { data, error, count } = await promise;
  if (error) throw new ApiError(error);
  return count !== undefined && count !== null ? { data, count } : data;
}

export async function rpc(name, params = {}) {
  const { data, error } = await sb.rpc(name, params);
  if (error) throw new ApiError(error);
  return data;
}

// Edge functions (ex.: 'admin-users')
export async function fn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    try {
      const ctx = await error.context?.json?.();
      if (ctx?.error) message = ctx.error;
    } catch {
      /* corpo não era JSON */
    }
    throw new ApiError({ message });
  }
  if (data && data.error) throw new ApiError({ message: data.error });
  return data;
}

// ---------- Imagens ----------
const IMG_EXT = /\.(jpe?g|png|webp|gif|svg)$/i;

// Reduz e converte para WebP no navegador (o plano gratuito não transforma imagens no servidor).
export async function prepareImage(file, { maxSize = 1600, quality = 0.84 } = {}) {
  if (!/^image\//.test(file.type)) throw new ApiError({ message: 'Envie um arquivo de imagem.' });
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', quality));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
}

// Envia para o bucket "media". scope: { storeId } ou { network: true }
export async function uploadImage(file, scope, { folder = 'uploads', maxSize } = {}) {
  const prepared = await prepareImage(file, { maxSize });
  const base = scope?.network ? 'network' : `stores/${scope.storeId}`;
  const ext = (prepared.name.match(IMG_EXT) || ['.webp'])[0].toLowerCase();
  const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const path = `${base}/${folder}/${name}`;
  const { error } = await sb.storage.from('media').upload(path, prepared, {
    cacheControl: '31536000',
    contentType: prepared.type,
    upsert: false,
  });
  if (error) throw new ApiError(error);
  return sb.storage.from('media').getPublicUrl(path).data.publicUrl;
}

// Remove do storage se a URL for do nosso bucket (fotos do catálogo de exemplo são locais e ficam).
export async function removeImage(url) {
  const marker = '/storage/v1/object/public/media/';
  const i = String(url || '').indexOf(marker);
  if (i < 0) return;
  await sb.storage.from('media').remove([url.slice(i + marker.length)]);
}

// URL pública de uma imagem: links completos ficam como estão; nomes curtos
// (ex.: "prod-01") apontam para as fotos do site em /assets/img.
export function mediaUrl(value, { webp = false } = {}) {
  if (!value) return '';
  if (/^(https?:)?\/\//.test(value) || value.startsWith('/') || value.startsWith('data:')) return value;
  return `/assets/img/${value}.${webp ? 'webp' : 'jpg'}`;
}

export const storefrontUrl = (slug) => `/loja/${slug}`;
