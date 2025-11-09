import Database from 'better-sqlite3';
import fs from 'fs';

const dbPath = './cookbook.db';

console.log('🔍 Starting source URL extraction from recipe descriptions...');

// Check if database exists
if (!fs.existsSync(dbPath)) {
  console.error('❌ Database file not found. Please run `npm run db:init` first.');
  process.exit(1);
}

const db = new Database(dbPath);

try {
  // Begin transaction
  db.exec('BEGIN TRANSACTION');

  // Find all recipes without a source_url
  const recipesWithoutSourceUrl = db.prepare(`
    SELECT id, title, description 
    FROM recipes 
    WHERE (source_url IS NULL OR source_url = '') 
    AND description IS NOT NULL 
    AND description != ''
  `).all();

  console.log(`📊 Found ${recipesWithoutSourceUrl.length} recipes without source_url to check.`);

  if (recipesWithoutSourceUrl.length === 0) {
    console.log('✅ No recipes need URL extraction.');
    db.exec('COMMIT');
    db.close();
    process.exit(0);
  }

  // URL regex pattern - matches http:// and https:// URLs (including YouTube URLs with query params)
  // This pattern is more permissive to catch YouTube URLs and other URLs with special characters
  const urlRegex = /(https?:\/\/[^\s\)\]\>\"\']+)/g;
  
  // Patterns for common URL prefixes (with capturing groups for URL extraction)
  // Using improved regex that handles YouTube URLs and URLs with query parameters
  const urlPatterns = [
    { pattern: /(?:^|\n)\s*Importiert von:\s*(https?:\/\/[^\s\)\]\>\"\']+)/i, name: 'Importiert von' },
    { pattern: /(?:^|\n)\s*Recipe imported from\s+(https?:\/\/[^\s\)\]\>\"\']+)/i, name: 'Recipe imported from' },
    { pattern: /(?:^|\n)\s*Das Video zum Rezept:\s*(https?:\/\/[^\s\)\]\>\"\']+)/i, name: 'Das Video zum Rezept' },
    { pattern: /(?:^|\n)\s*Video zum Rezept:\s*(https?:\/\/[^\s\)\]\>\"\']+)/i, name: 'Video zum Rezept' },
    { pattern: /(?:^|\n)\s*Video:\s*(https?:\/\/[^\s\)\]\>\"\']+)/i, name: 'Video' },
    { pattern: /(?:^|\n)\s*Quelle:\s*(https?:\/\/[^\s\)\]\>\"\']+)/i, name: 'Quelle' },
    { pattern: /(?:^|\n)\s*Source:\s*(https?:\/\/[^\s\)\]\>\"\']+)/i, name: 'Source' },
  ];
  
  // Full patterns for removal (includes the entire line with text before URL)
  const removalPatterns = [
    /(?:^|\n)\s*Importiert von:\s*https?:\/\/[^\s\)\]\>\"\']+[^\n]*/gi,
    /(?:^|\n)\s*Recipe imported from\s+https?:\/\/[^\s\)\]\>\"\']+[^\n]*/gi,
    /(?:^|\n)\s*Das Video zum Rezept:\s*https?:\/\/[^\s\)\]\>\"\']+[^\n]*/gi,
    /(?:^|\n)\s*Video zum Rezept:\s*https?:\/\/[^\s\)\]\>\"\']+[^\n]*/gi,
    /(?:^|\n)\s*Video:\s*https?:\/\/[^\s\)\]\>\"\']+[^\n]*/gi,
    /(?:^|\n)\s*Quelle:\s*https?:\/\/[^\s\)\]\>\"\']+[^\n]*/gi,
    /(?:^|\n)\s*Source:\s*https?:\/\/[^\s\)\]\>\"\']+[^\n]*/gi,
  ];

  let updatedCount = 0;
  let skippedCount = 0;

  const updateStmt = db.prepare(`
    UPDATE recipes 
    SET description = ?, source_url = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  for (const recipe of recipesWithoutSourceUrl) {
    const description = recipe.description;
    let extractedUrl = null;
    let cleanedDescription = description;
    let matchedPattern = null;

    // First, try to find URLs with known patterns
    for (const urlPattern of urlPatterns) {
      const match = description.match(urlPattern.pattern);
      if (match) {
        extractedUrl = match[1];
        matchedPattern = urlPattern.name;
        break;
      }
    }

    if (extractedUrl && matchedPattern) {
      // Remove the entire line containing the URL using the corresponding removal pattern
      const patternIndex = urlPatterns.findIndex(p => p.name === matchedPattern);
      if (patternIndex >= 0 && patternIndex < removalPatterns.length) {
        cleanedDescription = description
          .replace(removalPatterns[patternIndex], '') // Remove the entire line
          .replace(/\n\s*\n\s*\n+/g, '\n\n') // Clean up multiple consecutive newlines
          .trim();
      }
    } else {
      // If no specific pattern found, look for any URL in the description
      const urlMatches = description.match(urlRegex);
      if (urlMatches && urlMatches.length > 0) {
        // Take the first URL found
        extractedUrl = urlMatches[0];
        
        // Find the line containing the URL and remove the entire line
        const lines = description.split('\n');
        const cleanedLines = lines.filter(line => {
          // Check if line contains the URL (handle partial matches for URLs with query params)
          const urlInLine = line.match(urlRegex);
          if (!urlInLine) return true;
          // Remove line if it contains the extracted URL (or a URL that starts with the same base)
          return !urlInLine.some(url => url === extractedUrl || extractedUrl.startsWith(url) || url.startsWith(extractedUrl));
        });
        cleanedDescription = cleanedLines.join('\n')
          .replace(/\n\s*\n\s*\n+/g, '\n\n') // Clean up multiple consecutive newlines
          .trim();
      }
    }

    if (extractedUrl) {
      // Clean up the extracted URL (remove trailing punctuation that might have been captured)
      extractedUrl = extractedUrl.replace(/[.,;:!?]+$/, '');
      
      // Validate that it's a proper URL
      try {
        new URL(extractedUrl);
        
        // Ensure cleanedDescription is not empty - if it is, set it to null
        const finalDescription = cleanedDescription.trim() === '' ? null : cleanedDescription.trim();
        
        // Update the recipe
        updateStmt.run(finalDescription, extractedUrl, recipe.id);
        updatedCount++;
        console.log(`  ✅ Extracted URL for recipe: "${recipe.title}"`);
        console.log(`     URL: ${extractedUrl}`);
        if (finalDescription === null) {
          console.log(`     Note: Description was empty after URL removal, set to null`);
        }
      } catch (error) {
        // Invalid URL, skip it
        console.log(`  ⚠️  Skipped invalid URL for recipe: "${recipe.title}"`);
        console.log(`     Invalid URL: ${extractedUrl}`);
        console.log(`     Error: ${error.message}`);
        skippedCount++;
      }
    } else {
      skippedCount++;
      console.log(`  ⏭️  No URL found in description for recipe: "${recipe.title}"`);
    }
  }

  // Commit transaction
  db.exec('COMMIT');

  console.log('\n📊 Summary:');
  console.log(`  ✅ Updated: ${updatedCount} recipes`);
  console.log(`  ⏭️  Skipped: ${skippedCount} recipes`);
  console.log(`  📝 Total processed: ${recipesWithoutSourceUrl.length} recipes`);

  if (updatedCount > 0) {
    console.log('\n🎉 Source URL extraction completed successfully!');
  } else {
    console.log('\n✅ No URLs were extracted from descriptions.');
  }

} catch (error) {
  // Rollback transaction on error
  db.exec('ROLLBACK');
  console.error('\n❌ Extraction failed:', error.message);
  console.error(error.stack);
  process.exit(1);
} finally {
  db.close();
}

