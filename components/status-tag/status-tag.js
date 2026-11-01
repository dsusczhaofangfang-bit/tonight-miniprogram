const STATUS_MAP = {
  pending: { text: '待接单', tone: 'amber' },
  accepted: { text: '已接单', tone: 'champagne' },
  making: { text: '制作中', tone: 'rose' },
  completed: { text: '已完成', tone: 'green' },
  cancelled: { text: '已取消', tone: 'muted' }
};

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
      const meta = STATUS_MAP[value] || { text: value || '未知', tone: 'muted' };
      this.setData(meta);
    }
  }
});