/**
 * render/gl/Mat4.js — 4x4 列主序矩阵工具（WebGL 约定）
 *
 * 移植自参考实现 simulation-matrix/common/math/mat4.js，并补全：
 *  - mat4TRS：欧拉角（yaw=Y, pitch=X, roll=Z，合成顺序 R = Ry·Rx·Rz）模型矩阵；
 *  - vec3ApplyMat4 / mat4MulVec4：向量变换。
 *
 * 零分配约定：所有 out 均由调用方传入 Float32Array(16)（vec3 为 Float32Array(3)），
 * 渲染循环内不产生任何新数组。存储布局：m[col * 4 + row]（列主序）。
 */

/** 新建单位矩阵（唯一的分配点：仅限初始化阶段调用） */
export function mat4() {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

/** out = 单位矩阵 */
export function mat4Identity(out) {
  out.fill(0);
  out[0] = 1; out[5] = 1; out[10] = 1; out[15] = 1;
  return out;
}

/** out = a * b（列主序；语义为先施加 b 再施加 a） */
export function mat4Multiply(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
    out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
}

/** 透视投影矩阵（fovy 为竖直视场角，弧度） */
export function mat4Perspective(out, fovyRad, aspect, near, far) {
  const f = 1 / Math.tan(fovyRad / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

/** 正交投影矩阵 */
export function mat4Ortho(out, left, right, bottom, top, near, far) {
  out.fill(0);
  out[0] = 2 / (right - left);
  out[5] = 2 / (top - bottom);
  out[10] = -2 / (far - near);
  out[12] = -(right + left) / (right - left);
  out[13] = -(top + bottom) / (top - bottom);
  out[14] = -(far + near) / (far - near);
  out[15] = 1;
  return out;
}

/** 视图矩阵：相机位于 eye，看向 center，up 为世界上方向（右手系） */
export function mat4LookAt(out, eye, center, up) {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let len = Math.sqrt(zx * zx + zy * zy + zz * zz);
  if (len === 0) { zx = 0; zy = 0; zz = 1; len = 1; }
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.sqrt(xx * xx + xy * xy + xz * xz);
  if (len === 0) { xx = 1; xy = 0; xz = 0; } else { xx /= len; xy /= len; xz /= len; }
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

/** 一般 4x4 求逆（伴随展开法）。奇异矩阵返回 null。 */
export function mat4Invert(out, m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1.0 / det;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

/** 平移矩阵（覆盖 out，非右乘叠加） */
export function mat4Translate(out, x, y, z) {
  mat4Identity(out);
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}

/** 缩放矩阵（覆盖 out） */
export function mat4Scale(out, x, y, z) {
  mat4Identity(out);
  out[0] = x; out[5] = y; out[10] = z;
  return out;
}

/** 绕 X 轴旋转矩阵（弧度，右手系；覆盖 out） */
export function mat4RotateX(out, rad) {
  mat4Identity(out);
  const c = Math.cos(rad), s = Math.sin(rad);
  out[5] = c; out[6] = s; out[9] = -s; out[10] = c;
  return out;
}

/** 绕 Y 轴旋转矩阵（弧度，右手系；覆盖 out） */
export function mat4RotateY(out, rad) {
  mat4Identity(out);
  const c = Math.cos(rad), s = Math.sin(rad);
  out[0] = c; out[2] = -s; out[8] = s; out[10] = c;
  return out;
}

/** 绕 Z 轴旋转矩阵（弧度，右手系；覆盖 out） */
export function mat4RotateZ(out, rad) {
  mat4Identity(out);
  const c = Math.cos(rad), s = Math.sin(rad);
  out[0] = c; out[1] = s; out[4] = -s; out[5] = c;
  return out;
}

/**
 * 欧拉合成模型矩阵：out = T(t) · Ry(ry) · Rx(rx) · Rz(rz) · S(s)
 * 约定：ry = yaw（偏航，绕 Y），rx = pitch（俯仰，绕 X），rz = roll（翻滚，绕 Z），
 * 旋转合成顺序为 R = Ry·Rx·Rz（先 roll，再 pitch，最后 yaw）。
 * 解析展开一次写就，避免中间矩阵与临时分配。
 */
export function mat4TRS(out, tx, ty, tz, rx, ry, rz, s) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  // R = Ry·Rx·Rz 的三个列向量（展开自 (cy·cz + sy·sx·sz) 等解析式）
  out[0] = (cy * cz + sy * sx * sz) * s;   // 列 0 行 0：R·e_x.x
  out[1] = cx * sz * s;                    // 列 0 行 1
  out[2] = (-sy * cz + cy * sx * sz) * s;  // 列 0 行 2
  out[3] = 0;
  out[4] = (-cy * sz + sy * sx * cz) * s;  // 列 1 行 0：R·e_y.x
  out[5] = cx * cz * s;                    // 列 1 行 1
  out[6] = (sy * sz + cy * sx * cz) * s;   // 列 1 行 2
  out[7] = 0;
  out[8] = sy * cx * s;                    // 列 2 行 0：R·e_z.x
  out[9] = -sx * s;                        // 列 2 行 1
  out[10] = cy * cx * s;                   // 列 2 行 2
  out[11] = 0;
  out[12] = tx;                            // 列 3：平移
  out[13] = ty;
  out[14] = tz;
  out[15] = 1;
  return out;
}

/**
 * 用 4x4 矩阵变换三维点/向量（隐含 w=1）并做透视除法（w=0 时按 1 处理）。
 * out 为 Float32Array(3)，允许 out === v。
 */
export function vec3ApplyMat4(out, m, v) {
  const x = v[0], y = v[1], z = v[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  const inv = w !== 0 ? 1 / w : 1;
  out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) * inv;
  out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) * inv;
  out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) * inv;
  return out;
}

/** 用 4x4 矩阵变换四维向量（完整分量，含 w 行），允许 out === v。 */
export function mat4MulVec4(out, m, v) {
  const x = v[0], y = v[1], z = v[2], w = v[3];
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
  out[3] = m[3] * x + m[7] * y + m[11] * z + m[15] * w;
  return out;
}
