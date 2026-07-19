const axios = require('axios');
const MS2_URL = process.env.MS2_URL || 'http://localhost:8000';

const searchBooth = async (req, res) => {
  const { constituencyId, pollingStationId, nameFilter } = req.query;
  
  if (!constituencyId && !pollingStationId) {
    return res.status(400).json({ error: 'ValidationError', message: 'constituencyId or pollingStationId is required' });
  }

  try {
    const prisma = require('../lib/prisma');
    
    let constituency_code;
    let polling_station_no = null;

    if (pollingStationId) {
        const station = await prisma.pollingStation.findUnique({
          where: { id: pollingStationId },
          include: { constituency: true }
        });
        if (!station) {
          return res.status(404).json({ error: 'NotFound', message: 'Polling station not found' });
        }
        constituency_code = station.constituency.code;
        polling_station_no = station.number;
    } else {
        const constituency = await prisma.constituency.findUnique({
          where: { id: constituencyId }
        });
        if (!constituency) {
          return res.status(404).json({ error: 'NotFound', message: 'Constituency not found' });
        }
        constituency_code = constituency.code;
    }

    let ms2Query = `${MS2_URL}/search/booth?constituency_code=${encodeURIComponent(constituency_code)}`;
    if (polling_station_no) {
        ms2Query += `&polling_station_no=${encodeURIComponent(polling_station_no)}`;
    }
    if (nameFilter) {
      ms2Query += `&name_filter=${encodeURIComponent(nameFilter)}`;
    }

    const response = await axios.get(ms2Query);
    
    // In ms2, the result shape is now flattened ECI-style columns:
    const formattedResults = (response.data.results || []).map((row) => {
        return {
            name: row.elector_name,
            relative_name: row.relative_name,
            relative_type: row.relative_type,
            age: row.age,
            gender: row.gender,
            house_number: row.house_number,
            voter_id: row.epic_number,
            part_serial_no: row.part_serial_no,
            state: row.state,
            district: row.district,
            ac_number: row.ac_number,
            ac_name: row.ac_name,
            polling_station_no: row.polling_station_no,
            polling_station_name: row.polling_station_name
        };
    });

    return res.status(200).json({ results: formattedResults, count: formattedResults.length });
  } catch (err) {
    console.error('[searchController] error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Error querying graph' });
  }
};

module.exports = { searchBooth };
