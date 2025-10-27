const supabase = require('./config/supabase');

async function debugPsychologists() {
  try {
    console.log('🔍 Checking all psychologists in database...\n');
    
    // Get all psychologists
    const { data: psychologists, error } = await supabase
      .from('psychologists')
      .select('id, email, first_name, last_name, google_calendar_credentials')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('❌ Error fetching psychologists:', error);
      return;
    }
    
    console.log(`📊 Found ${psychologists.length} psychologists:\n`);
    
    psychologists.forEach((psychologist, index) => {
      console.log(`${index + 1}. ${psychologist.first_name} ${psychologist.last_name}`);
      console.log(`   Email: ${psychologist.email}`);
      console.log(`   ID: ${psychologist.id}`);
      
      if (psychologist.google_calendar_credentials) {
        const creds = psychologist.google_calendar_credentials;
        console.log(`   ✅ Google Calendar Connected`);
        console.log(`   Connected at: ${creds.connected_at}`);
        console.log(`   Scope: ${creds.scope}`);
        console.log(`   Access token length: ${creds.access_token?.length || 0}`);
        console.log(`   Refresh token length: ${creds.refresh_token?.length || 0}`);
        console.log(`   Expiry date: ${creds.expiry_date ? new Date(creds.expiry_date).toISOString() : 'N/A'}`);
      } else {
        console.log(`   ❌ No Google Calendar credentials`);
      }
      console.log('');
    });
    
    // Check for dummy emails
    const dummyEmails = psychologists.filter(p => 
      p.email.includes('test') || 
      p.email.includes('dummy') || 
      p.email.includes('fake') ||
      p.email.includes('example.com') ||
      p.email.includes('test.com')
    );
    
    if (dummyEmails.length > 0) {
      console.log('🚨 Found psychologists with dummy/test emails:');
      dummyEmails.forEach(psychologist => {
        console.log(`   - ${psychologist.email} (${psychologist.first_name} ${psychologist.last_name})`);
      });
      console.log('');
    }
    
    // Check which psychologists have Google Calendar credentials
    const withCredentials = psychologists.filter(p => p.google_calendar_credentials);
    console.log(`📈 Summary:`);
    console.log(`   Total psychologists: ${psychologists.length}`);
    console.log(`   With Google Calendar: ${withCredentials.length}`);
    console.log(`   Without Google Calendar: ${psychologists.length - withCredentials.length}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

debugPsychologists();
