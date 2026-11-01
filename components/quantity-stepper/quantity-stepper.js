Component({
  properties: {
    value: { type: Number, value: 0 },
    min: { type: Number, value: 0 },
    max: { type: Number, value: 99 }
  },

  methods: {
    onMinus() {
      this.change(this.data.value - 1);
    },

    onPlus() {
      this.change(this.data.value + 1);
    },

    change(next) {
      const value = Math.min(this.data.max, Math.max(this.data.min, next));
      if (value === this.data.value) return;
      this.triggerEvent('change', { value });
    }
  }
});