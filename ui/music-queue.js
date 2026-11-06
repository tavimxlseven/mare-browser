// Playback order is independent of the library's display order.
(function (root) {
  class MusicQueue {
    constructor(random = Math.random) {
      this.random = random;
      this.order = [];
      this.original = [];
      this.position = -1;
      this.shuffled = false;
      this.repeat = "off";
    }
    mix(items) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    }
    start(ids, selected) {
      this.original = [...new Set(ids)];
      if (!this.original.includes(selected)) this.original.unshift(selected);
      this.order = this.shuffled
        ? [selected, ...this.mix(this.original.filter((id) => id !== selected))]
        : [...this.original];
      this.position = this.order.indexOf(selected);
      return selected;
    }
    current() {
      return this.order[this.position] ?? null;
    }
    upcoming() {
      return this.order.slice(this.position + 1);
    }
    setShuffle(enabled) {
      this.shuffled = enabled;
      const played = this.order.slice(0, this.position + 1);
      const pending = this.upcoming();
      this.order = [
        ...played,
        ...(enabled
          ? this.mix(pending)
          : [...pending].sort(
              (a, b) => this.original.indexOf(a) - this.original.indexOf(b),
            )),
      ];
    }
    next(automatic = false) {
      if (!this.order.length) return null;
      if (automatic && this.repeat === "one") return this.current();
      if (this.position + 1 < this.order.length)
        return this.order[++this.position];
      if (this.repeat !== "all") return null;
      if (this.shuffled) {
        const previous = this.current();
        this.order = this.mix(this.original);
        if (this.order.length > 1 && this.order[0] === previous)
          [this.order[0], this.order[1]] = [this.order[1], this.order[0]];
      }
      this.position = 0;
      return this.current();
    }
    previous() {
      if (this.position > 0) this.position--;
      return this.current();
    }
    add(id) {
      if (!this.order.length) {
        this.order.push(id);
        this.original.push(id);
        this.position = -1;
        return;
      }
      this.order.push(id);
      if (!this.original.includes(id)) this.original.push(id);
    }
    removeAt(index) {
      if (index <= this.position || index >= this.order.length) return;
      this.order.splice(index, 1);
    }
    move(from, to) {
      if (
        from <= this.position ||
        to <= this.position ||
        from >= this.order.length ||
        to >= this.order.length
      )
        return;
      this.order.splice(to, 0, this.order.splice(from, 1)[0]);
    }
    selectAt(index) {
      if (index < 0 || index >= this.order.length) return null;
      this.position = index;
      return this.current();
    }
    prune(available) {
      const played = this.order
        .slice(0, this.position + 1)
        .filter((id) => available.has(id));
      const pending = this.upcoming().filter((id) => available.has(id));
      this.order = [...played, ...pending];
      this.position = played.length - 1;
      this.original = this.original.filter((id) => available.has(id));
    }
  }
  root.MareMusicQueue = MusicQueue;
  if (typeof module !== "undefined") module.exports = MusicQueue;
})(typeof window !== "undefined" ? window : globalThis);
