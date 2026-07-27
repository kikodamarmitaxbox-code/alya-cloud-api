const fs = require('fs')
const path = require('path')
const StorageInterface = require('./StorageInterface')

class FileStorage extends StorageInterface {
  constructor(baseDir) {
    super()
    this.baseDir = baseDir
  }

  async init() {
    await fs.promises.mkdir(this.baseDir, { recursive: true })
  }

  _filePath(key) {
    const safeKey = key.replace(/[:]/g, '-');
    return path.join(this.baseDir, `${safeKey}.json`)
  }

  async get(key) {
    try {
      const data = await fs.promises.readFile(this._filePath(key), 'utf8')
      return JSON.parse(data)
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }

  async set(key, value) {
    const tmpPath = `${this._filePath(key)}.tmp`
    await fs.promises.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8')
    await fs.promises.rename(tmpPath, this._filePath(key))
  }

  async list(prefix) {
    const files = await fs.promises.readdir(this.baseDir)
    return files
      .filter((file) => file.startsWith(`${prefix}.`) && file.endsWith('.json'))
      .map((file) => file.slice(0, -'.json'.length))
  }

  async delete(key) {
    try {
      await fs.promises.unlink(this._filePath(key))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }

  async close() {
    // No-op for file storage
  }
}

module.exports = FileStorage
