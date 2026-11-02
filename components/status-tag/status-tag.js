const { ORDER_STATUS_TEXT, ORDER_STATUS_TONE } = require('../../utils/constants');

Component({
  properties: {
    status: { type: String, value: '' }
  },

  data: {
    text: '',
    tone: 'muted'
  },

  observers: {
    status(value) {
      this.setData({
        text: ORDER_STATUS_TEXT[value] || value || '未知',
        tone: ORDER_STATUS_TONE[value] || 'muted'
      });
    }
  }
});