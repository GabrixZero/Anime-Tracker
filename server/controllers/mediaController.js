const mediaService = require('../services/mediaService');

class MediaController {
  async getTrending(req, res) {
    try {
      const type = req.query.type || 'all'; // all | tv | anime | movie
      const items = await mediaService.getTrending(type);
      return res.json({ count: items.length, data: items });
    } catch (err) {
      console.error('Erro ao buscar destaques:', err);
      return res.status(500).json({ error: 'Erro ao buscar catálogo de destaques.' });
    }
  }

  async search(req, res) {
    try {
      const query = req.query.q || '';
      const type = req.query.type || 'all';
      const items = await mediaService.search(query, type);
      return res.json({ query, count: items.length, data: items });
    } catch (err) {
      console.error('Erro na pesquisa:', err);
      return res.status(500).json({ error: 'Erro na pesquisa de mídia.' });
    }
  }

  async getById(req, res) {
    try {
      const id = req.params.id;
      const item = await mediaService.getById(id);
      if (!item) {
        return res.status(404).json({ error: 'Título não encontrado.' });
      }
      return res.json({ data: item });
    } catch (err) {
      console.error('Erro ao buscar detalhes:', err);
      return res.status(500).json({ error: 'Erro ao buscar detalhes da obra.' });
    }
  }

  async ingest(req, res) {
    try {
      const id = req.body.id;
      if (!id) {
        return res.status(400).json({ error: 'ID é obrigatório para ingestão.' });
      }
      const item = await mediaService.ingest(id);
      return res.json({ success: true, data: item });
    } catch (err) {
      console.error('Erro ao ingerir obra:', err);
      return res.status(500).json({ error: 'Falha ao ingerir obra no catálogo.' });
    }
  }
}

module.exports = new MediaController();
