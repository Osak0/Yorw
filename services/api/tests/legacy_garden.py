"""Seed pre-removal schemas with the old topic visibility contract for upgrade tests."""
from yorw_api.garden import Garden

class PreRemovalGarden(Garden):
    def _rows(self, query, args=()):
        return super()._rows(query.replace(' AND deleted_at IS NULL', '').replace(' WHERE deleted_at IS NULL', ''), args)
