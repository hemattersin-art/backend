const path = require('path');
require('dotenv').config({
  path: path.resolve(__dirname, '..', '.env')
});

const { handlePaymentSuccess } = require('../controllers/paymentController');
const { supabaseAdmin } = require('../config/supabase');

const CLIENT_ID = '4e560824-32ef-4fe6-af60-0e7cf91572e0';
const PSYCHOLOGIST_ID = '85780653-cc64-4da4-ae99-6295257e966e';
const PACKAGE_ID = '994cd55d-47b5-4a2b-941a-5ce11d17cd54';
const PACKAGE_PRICE = 899;

const createPaymentRecord = async (txnid, scheduledDate, scheduledTime) => {
  const paymentInsert = await supabaseAdmin
    .from('payments')
    .insert({
      transaction_id: txnid,
      client_id: CLIENT_ID,
      psychologist_id: PSYCHOLOGIST_ID,
      package_id: PACKAGE_ID,
      amount: PACKAGE_PRICE,
      status: 'pending',
      session_type: 'Package Session',
      payu_params: {
        udf1: scheduledDate,
        udf2: PSYCHOLOGIST_ID,
        udf3: CLIENT_ID,
        udf4: PACKAGE_ID,
        udf5: scheduledTime
      },
      created_at: new Date().toISOString()
    })
    .select('*')
    .single();

  if (paymentInsert.error) {
    throw paymentInsert.error;
  }

  return paymentInsert.data;
};

const buildSuccessPayload = (txnid, scheduledDate, scheduledTime) => ({
  txnid,
  status: 'success',
  amount: `${PACKAGE_PRICE}.00`,
  udf1: scheduledDate,
  udf2: PSYCHOLOGIST_ID,
  udf3: CLIENT_ID,
  udf4: PACKAGE_ID,
  udf5: scheduledTime,
  udf6: null,
  udf7: null
});

const invokeHandlePaymentSuccess = async (payload) => {
  return new Promise((resolve, reject) => {
    const req = { body: payload };
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        resolve({ statusCode: this.statusCode || 200, body: data });
      }
    };

    handlePaymentSuccess(req, res).catch(reject);
  });
};

const fetchClientPackages = async () => {
  return supabaseAdmin
    .from('client_packages')
    .select('*')
    .eq('client_id', CLIENT_ID)
    .eq('package_id', PACKAGE_ID)
    .order('purchased_at', { ascending: false });
};

const main = async () => {
  const now = new Date();
  const scheduledDate = new Date(now.getTime() + 24 * 60 * 60 * 1000) // tomorrow
    .toISOString()
    .slice(0, 10);
  const scheduledTime = '18:00:00';
  const txnid = `TEST_PKG_${Date.now()}`;

  console.log('🔧 Creating test payment record...');
  await createPaymentRecord(txnid, scheduledDate, scheduledTime);

  console.log('🚀 Invoking handlePaymentSuccess...');
  const payload = buildSuccessPayload(txnid, scheduledDate, scheduledTime);
  const response = await invokeHandlePaymentSuccess(payload);
  console.log('✅ handlePaymentSuccess response:', response);

  console.log('🔍 Fetching client packages...');
  const packagesResult = await fetchClientPackages();
  if (packagesResult.error) {
    throw packagesResult.error;
  }

  console.log('📦 Client packages found:', packagesResult.data);

  if (!packagesResult.data || packagesResult.data.length === 0) {
    throw new Error('Client package was not created');
  }

  console.log('🎉 Package booking flow verified successfully.');
};

main().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});

