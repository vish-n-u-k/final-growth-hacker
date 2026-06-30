-- Find duplicate Community Finder modules
SELECT id, brand_id, type, name, created_at 
FROM modules 
WHERE type = 'community-finder' 
ORDER BY created_at;
