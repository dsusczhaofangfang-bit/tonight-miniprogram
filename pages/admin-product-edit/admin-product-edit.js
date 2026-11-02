const guard = require('../../utils/admin-guard');
const productService = require('../../services/products');
const categoryService = require('../../services/categories');
const { yuanToFen, fenToYuanInput } = require('../../utils/format');

Page({
  data: {
    mode: 'create',
    productId: '',
    categories: [],
    categoryIndex: 0,
    // 图片不在这里编辑：只读展示，由系统维护者统一更新
    imageUrl: '',
    form: {
      name: '',
      nameEn: '',
      priceYuan: '',
      description: '',
      isAvailable: true
    },
    loading: true,
    saving: false,
    error: '',
    session: null
  },

  onLoad(options) {
    const id = (options && options.id) || '';
    this.setData({ mode: id ? 'edit' : 'create', productId: id });
    wx.setNavigationBarTitle({ title: id ? '编辑商品' : '新增商品' });

    guard.ensureOwner(this).then((ok) => {
      if (ok) this.load(id);
    });
  },

  load(id) {
    return categoryService.listCategories().then((catRes) => {
      const categories = catRes.code === 0 ? catRes.data : [];
      this.setData({ categories });

      if (!id) {
        this.setData({ loading: false });
        return Promise.resolve();
      }

      return productService.getProduct(id).then((res) => {
        if (res.code !== 0) {
          this.setData({ loading: false, error: res.message || '商品不存在' });
          return;
        }

        const product = res.data;
        const index = categories.findIndex((item) => item.id === product.category);

        this.setData({
          loading: false,
          categoryIndex: index >= 0 ? index : 0,
          imageUrl: product.image || '',
          form: {
            name: product.name || '',
            nameEn: product.nameEn || '',
            priceYuan: fenToYuanInput(product.price || 0),
            description: product.description || '',
            isAvailable: product.isAvailable !== false
          }
        });
      });
    });
  },

  onNameInput(event) {
    this.setData({ 'form.name': event.detail.value, error: '' });
  },

  onNameEnInput(event) {
    this.setData({ 'form.nameEn': event.detail.value });
  },

  onPriceInput(event) {
    this.setData({ 'form.priceYuan': event.detail.value, error: '' });
  },

  onDescInput(event) {
    this.setData({ 'form.description': event.detail.value });
  },

  onCategoryChange(event) {
    this.setData({ categoryIndex: Number(event.detail.value) || 0, error: '' });
  },

  onAvailableChange(event) {
    this.setData({ 'form.isAvailable': event.detail.value !== false });
  },

  // 只读预览：图片加载失败时回落到占位块，不让破图占位
  onImageError() {
    this.setData({ imageUrl: '' });
  },

  // 校验后交给 services：价格按整数分提交，页面不写 storage
  onSave() {
    if (this.data.saving) return;

    const form = this.data.form;
    const name = String(form.name || '').trim();
    if (!name) {
      this.setData({ error: '请填写商品名称' });
      return;
    }

    const price = yuanToFen(form.priceYuan);
    if (price === null || price <= 0) {
      this.setData({ error: '价格请填写大于 0 的数字，最多两位小数' });
      return;
    }

    const category = this.data.categories[this.data.categoryIndex];
    if (!category) {
      this.setData({ error: '请选择商品分类' });
      return;
    }

    const payload = {
      name,
      nameEn: String(form.nameEn || '').trim(),
      category: category.id,
      price,
      description: String(form.description || '').trim(),
      isAvailable: form.isAvailable !== false
    };

    this.setData({ saving: true, error: '' });
    const request =
      this.data.mode === 'edit'
        ? productService.updateProduct(this.data.productId, payload)
        : productService.createProduct(payload);

    request
      .then((res) => {
        this.setData({ saving: false });
        if (res.code !== 0) {
          this.setData({ error: res.message || '保存失败' });
          return;
        }
        wx.showToast({ title: this.data.mode === 'edit' ? '已保存' : '已新增', icon: 'none' });
        // 返回列表页，列表 onShow 会重新读取
        wx.navigateBack({ delta: 1 });
      })
      .catch(() => {
        this.setData({ saving: false, error: '保存失败，请重试' });
      });
  },

  onBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.redirectTo({ url: '/pages/admin-products/admin-products' });
      }
    });
  }
});