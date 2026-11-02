const api = require('./api');

// 商品图片维护接口（预留，不对外开放）
//
// 本阶段的约定：
// 1. 商品图片不由老板在小程序里上传。相册选择得到的是临时文件路径，重启会失效，
//    不能写进商品数据；base64 又会迅速吃掉 storage 配额。
// 2. 老板端只做**只读预览**：image 有效就显示，为空就回落到 CSS 酒标式占位块。
// 3. 图片地址由系统维护者统一更新（压缩、上传云存储、拿到长期地址、再写回 image 字段）。
// 4. 维护者权限必须由服务端校验，不能靠前端隐藏入口。
//
// 正式版接入 CloudBase 后，这里替换为云函数调用：
//   uploadProductImage -> 上传云存储并返回 fileID / 长期 URL
//   删除旧图需先确认没有其他商品引用（引用计数在服务端做）
const MAX_IMAGE_BYTES = 300 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const NOT_OPEN = 4030;

function notOpen() {
  return api.fail(NOT_OPEN, '图片维护接口未开放（需云存储，暂由维护者统一更新）');
}

// 预留签名：{ productId, filePath } -> { image }
function uploadProductImage() {
  return notOpen();
}

// 预留签名：{ productId, filePath } -> { image }，替换后由服务端清理旧图引用
function replaceProductImage() {
  return notOpen();
}

// 预留签名：{ productId } -> {}，image 置空后回落到占位块
function removeProductImage() {
  return notOpen();
}

// 正式版的前置校验（格式 / 体积），本阶段仅作为契约声明
function isAcceptableImage(file = {}) {
  const size = Number(file.size);
  const type = String(file.type || '');
  return Number.isFinite(size) && size > 0 && size <= MAX_IMAGE_BYTES && ALLOWED_TYPES.indexOf(type) >= 0;
}

module.exports = {
  MAX_IMAGE_BYTES,
  ALLOWED_TYPES,
  uploadProductImage,
  replaceProductImage,
  removeProductImage,
  isAcceptableImage
};