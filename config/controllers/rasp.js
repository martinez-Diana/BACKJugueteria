const LOG = [];

function detectSQL(value) {
  const patterns = [
    /(\bOR\b|\bAND\b)\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?/i,
    /UNION\s+SELECT/i,
    /;\s*(DROP|DELETE|INSERT|UPDATE)\s/i,
  ];
  return patterns.some(p => p.test(value));
}

function detectXSS(value) {
  const patterns = [
    /<script[\s\S]*?>[\s\S]*?<\/script>/i,
    /javascript\s*:/i,
    /<\w+[^>]*\s+on\w+\s*=/i,
  ];
  return patterns.some(p => p.test(value));
}

function detectPathTraversal(value) {
  return /(\.\.[\/\\]){2,}/.test(value);
}

function scanObject(obj) {
  for (const key in obj) {
    const val = String(obj[key]);
    if (detectSQL(val))           return { type: 'SQL Injection',   field: key, value: val };
    if (detectXSS(val))           return { type: 'XSS',             field: key, value: val };
    if (detectPathTraversal(val)) return { type: 'Path Traversal',  field: key, value: val };
  }
  return null;
}

export function rasp(req, res, next) {
  const threat = scanObject(req.query) || scanObject(req.body || {}) || scanObject(req.params);
  if (threat) {
    const log = {
      timestamp: new Date().toISOString(),
      ip: req.ip,
      method: req.method,
      url: req.originalUrl,
      threat: threat.type,
      field: threat.field,
      payload: threat.value,
    };
    LOG.push(log);
    console.warn('🚨 RASP BLOQUEADO:', log);
    return res.status(403).json({
      error: 'Solicitud bloqueada por RASP',
      threat: threat.type,
      message: `Se detectó un intento de ${threat.type}. La solicitud fue bloqueada y registrada.`,
    });
  }
  next();
}

export function getLogs() { return LOG; }