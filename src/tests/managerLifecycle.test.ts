import assert from 'node:assert/strict';
import test from 'node:test';
import { User } from '../models/user.model';
import { Employee } from '../models/employee.model';
import { RecruitmentApplication } from '../models/recruitmentApplication.model';
import { automateEmployeeCreationOnApproval } from '../services/employeeLifecycleService';

test('approved manager application ID provisions existing account with assigned territory', async () => {
  const methods = { app: RecruitmentApplication.findOne, user: User.findOne, sponsor: User.findById, employee: Employee.findOne };
  const user: any = { _id: 'user', role: 'admin', async save() { return this; } };
  let query: any;
  try {
    (RecruitmentApplication as any).findOne = async (filter: any) => {
      query = filter;
      return { status: 'approved', applicationId: 'APP-SM-12345', role: 'state-manager', applicant: { email: 'manager@example.test', country: 'India' }, roleData: { state: 'Bihar' }, referrer: { referrerId: 'owner' }, documents: [{ documentType: 'Resume', url: 'https://example.test/resume.pdf' }, { documentType: 'SelfieWithIdCard', url: 'https://example.test/selfie.jpg' }] };
    };
    (User as any).findById = () => ({ lean: async () => ({ _id: 'owner', role: 'owner', hierarchyPath: '' }) });
    (User as any).findOne = async () => user;
    (Employee as any).findOne = async () => ({ userId: user._id });
    const result = await automateEmployeeCreationOnApproval('APP-SM-12345');
    assert.equal(result.success, true);
    assert.deepEqual(query, { $or: [{ applicationId: 'APP-SM-12345' }] });
    assert.equal(user.role, 'stateManager');
    assert.deepEqual(user.hiringScope, { country: 'india', state: 'bihar' });
    assert.equal(user.parentId, 'owner');
    assert.equal(user.documents.length, 2);
  } finally {
    RecruitmentApplication.findOne = methods.app;
    User.findOne = methods.user;
    User.findById = methods.sponsor;
    Employee.findOne = methods.employee;
  }
});
