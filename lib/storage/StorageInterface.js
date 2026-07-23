class StorageInterface {
  async init() {
    throw new Error('StorageInterface.init() must be implemented')
  }

  async get(key) {
    throw new Error('StorageInterface.get() must be implemented')
  }

  async set(key, value) {
    throw new Error('StorageInterface.set() must be implemented')
  }

  async list(prefix) {
    throw new Error('StorageInterface.list() must be implemented')
  }

  async delete(key) {
    throw new Error('StorageInterface.delete() must be implemented')
  }

  async close() {
    throw new Error('StorageInterface.close() must be implemented')
  }
}

module.exports = StorageInterface
